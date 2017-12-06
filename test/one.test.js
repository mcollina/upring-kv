'use strict'

const build = require('./helper').build
const t = require('tap')
const test = t.test

const instance = build()

t.tearDown(instance.close.bind(instance))

test('get empty', function (t) {
  t.plan(2)

  instance.ready(() => {
    instance.kv.get('hello', function (err, value) {
      t.error(err)
      t.equal(value, undefined)
    })
  })
})

test('get and put', function (t) {
  t.plan(3)

  instance.kv.put('hello', 'world', function (err) {
    t.error(err)

    instance.kv.get('hello', function (err, value) {
      t.error(err)
      t.equal(value, 'world')
    })
  })
})

test('get and JS objects', function (t) {
  t.plan(3)

  instance.kv.put('hello', { a: 42 }, function (err) {
    t.error(err)

    instance.kv.get('hello', function (err, value) {
      t.error(err)
      t.deepEqual(value, { a: 42 })
    })
  })
})

test('clones the object', function (t) {
  t.plan(3)

  const obj = { a: 42 }
  instance.kv.put('hello', obj, function (err) {
    t.error(err)

    instance.kv.get('hello', function (err, value) {
      t.error(err)
      t.notEqual(value, obj)
    })
  })
})

test('liveUpdates', function (t) {
  t.plan(5)

  const key = 'aaa'
  const expected = [
    'world',
    'matteo'
  ]

  const stream = instance.kv.liveUpdates(key)
    .on('data', function (data) {
      t.deepEqual(data, expected.shift())
      if (expected.length === 0) {
        stream.destroy()
        setImmediate(t.pass.bind(t), 'destroyed')
      }
    })

  t.tearDown(stream.destroy.bind(stream))

  instance.kv.put(key, 'world', function (err) {
    t.error(err)
    instance.kv.put(key, 'matteo', function (err) {
      t.error(err)
    })
  })
})

test('liveUpdates double', function (t) {
  t.plan(8)

  const key = 'hello2'

  const expected1 = [
    'world',
    'matteo'
  ]

  const expected2 = [
    'world',
    'matteo'
  ]

  const stream1 = instance.kv.liveUpdates(key)
    .on('data', function (data) {
      t.deepEqual(data, expected1.shift())
      if (expected1.length === 0) {
        stream1.destroy()
        setImmediate(t.pass.bind(t), 'destroyed')
      }
    })

  t.tearDown(stream1.destroy.bind(stream1))

  const stream2 = instance.kv.liveUpdates(key)
    .on('data', function (data) {
      t.deepEqual(data, expected2.shift())
      if (expected2.length === 0) {
        stream2.destroy()
        setImmediate(t.pass.bind(t), 'destroyed')
      }
    })

  t.tearDown(stream2.destroy.bind(stream2))

  instance.kv.put(key, 'world', function (err) {
    t.error(err)
    instance.kv.put(key, 'matteo', function (err) {
      t.error(err)
    })
  })
})

test('liveUpdates after', function (t) {
  t.plan(5)

  const expected = [
    'world',
    'matteo'
  ]

  instance.kv.put('hello', 'world', function (err) {
    t.error(err)

    const stream = instance.kv.liveUpdates('hello')
      .on('data', function (data) {
        t.deepEqual(data, expected.shift())
        if (expected.length === 0) {
          stream.destroy()
          setImmediate(t.pass.bind(t), 'destroyed')
        }
      })

    t.tearDown(stream.destroy.bind(stream))

    instance.kv.put('hello', 'matteo', function (err) {
      t.error(err)
    })
  })
})

if (Number(process.versions.node[0]) >= 8) {
  require('./async-await')(instance, t)
} else {
  t.pass('Skip because Node version < 8')
  t.end()
}
