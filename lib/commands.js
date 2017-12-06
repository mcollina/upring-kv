'use strict'

const eos = require('end-of-stream')
const Readable = require('readable-stream').Readable

function load (kv) {
  const upring = kv.upring
  const db = new Map()
  const streams = new Map()
  const ns = kv.ns

  upring.add(`ns:${ns},cmd:put`, put)
  upring.add(`ns:${ns},cmd:liveUpdates`, liveUpdates)
  upring.add(`ns:${ns},cmd:get`, get)

  function setupTracker (entry, reply, sendData) {
    if (entry.hasTracker) {
      reply()
      return
    }

    const key = entry.key

    entry.hasTracker = true
    entry.hasReplicator = false

    upring.log.debug({ key }, 'configuring tracker')

    const dest = upring._hashring.next(key)
    const tracker = upring.track(key, { replica: true })

    process.nextTick(function () {
      tracker.on('replica', sendData)
    })
    tracker.on('move', function (peer) {
      if (peer) {
        sendData(peer)
      }
      entry.hasTracker = false
      const rs = streams.get(key) || []
      rs.forEach((stream) => {
        stream.push(null)
      })
      streams.delete(key)
      setTimeout(function () {
        if (!entry.hasReplicator && !entry.hasTracker) {
          db.delete(key)
        }
      }, 30000).unref()
    })

    if (dest) {
      sendData(dest, reply)
      return false
    }

    return true
  }

  function setupReplicator (entry, sendData) {
    const key = entry.key
    entry.hasReplicator = true
    upring.log.debug({ key }, 'configuring replicator')
    upring.replica(key, function () {
      entry.hasReplicator = false
      setupTracker(entry, noop, sendData)
    })
  }

  function Entry (key) {
    this.key = key
    this.hasTracker = false
    this.hasReplicator = false
    this.value = null
  }

  function put (req, reply) {
    const key = req.key
    const sendData = genSendData(key)
    const entry = db.get(key) || new Entry(key)
    var needReply = true

    entry.value = req.value
    db.set(key, entry)

    if (upring.allocatedToMe(key)) {
      if (!entry.hasTracker) {
        needReply = setupTracker(entry, reply, sendData)
      }
    } else {
      if (!entry.hasReplicator) {
        setupReplicator(entry, sendData)
      }
    }

    upring.log.debug({ key, value: req.value }, 'setting data')

    if (needReply) {
      reply()
    }

    const array = streams.get(key)

    if (array) {
      array.forEach((stream) => stream.push(req.value))
    }
  }

  function genSendData (key) {
    return sendData

    function sendData (peer, cb) {
      if (typeof cb !== 'function') {
        cb = retry
      }

      const entry = db.get(key)
      if (!entry) {
        cb()
        return
      }

      const req = {
        ns: ns,
        cmd: 'put',
        key: entry.key,
        value: entry.value
      }

      upring.peerConn(peer).request(req, function (err) {
        if (err) {
          cb(err)
          return
        }

        upring.log.debug({ key, value: entry.value, to: peer }, 'replicated key')

        cb()
      })
    }

    function retry (err) {
      if (err) {
        upring.log.error(err)
        const dest = upring._hashring.next(key)
        if (!dest) {
          return upring.emit('error', err)
        }

        sendData(dest)
      }
    }
  }

  function get (req, reply) {
    const entry = db.get(req.key)
    const key = req.key
    req.skipList = req.skipList || []
    req.skipList.push(upring.whoami())
    const dest = upring._hashring.next(key, req.skipList)

    if ((entry && entry.value) || !dest) {
      reply(null, { key, value: entry ? entry.value : undefined })
    } else {
      upring.log.debug({ key }, 'data not found, checking if we are in the middle of a migration')
      upring.peerConn(dest)
        .request(req, function (err, res) {
          if (err) {
            reply(err)
            return
          }

          const entry = db.get(key)

          if (res && res.value && !entry && upring.allocatedToMe(key)) {
            upring.log.debug({ key }, 'set data because of migration')
            put({
              ns: ns,
              cmd: 'put',
              key,
              value: res.value
            }, function (err) {
              if (err) {
                reply(err)
                return
              }

              reply(null, res)
            })

            return
          }

          reply(null, res)
        })
    }
  }

  function liveUpdates (req, reply) {
    var array = streams.get(req.key)

    if (!array) {
      array = []
      streams.set(req.key, array)
    }

    const updates = new Readable({
      objectMode: true
    })

    updates._read = function () {}

    eos(updates, function () {
      array.splice(array.indexOf(updates), 1)
    })

    array.push(updates)

    const entry = db.get(req.key)
    if (entry && entry.hasTracker) {
      updates.push(entry.value)
    }

    reply(null, { streams: { updates } })
  }
}

function noop () {}

module.exports = load
