const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  ts = require('typescript'),
  Module = require('node:module')
const { createPinia, setActivePinia } = require('pinia')
const axis = (min, max, count) => ({ min, max, count, step: (max - min) / count })
const frame = (id, i) => ({
  datasetId: id,
  timeIndex: i,
  metadata: {
    id: id + i,
    source: 'sami3-model',
    parameter: 'Ne',
    unit: 'm^-3',
    altitudeUnit: 'km',
    sampling: 'cell-center',
    order: 'zyx',
    dtype: 'float32',
    byteOrder: 'little',
    byteLength: 96,
    timestamp: `2019-04-25T0${i}:00:00Z`,
    longitude: axis(-180, 180, 2),
    latitude: axis(-90, 90, 2),
    altitude: axis(100, 700, 6),
    minValue: 1e11,
    maxValue: 1e11,
  },
  values: Array(24).fill(1e11 * (i + 1)),
})
const dataset = (id) => ({
  id,
  status: 'preview',
  name: id,
  preview: {
    timeCount: 3,
    times: [0, 1, 2].map((index) => ({ index, timestamp: `2019-04-25T0${index}:00:00Z` })),
  },
  imports: [],
})
function setup(overrides = {}) {
  setActivePinia(createPinia())
  const mocks = {
    fetchOverviewFrame: async (id, i) => frame(id, i),
    fetchSpaceWeather: async () => ({ available: false, kp: null, reason: 'test' }),
    ...overrides,
  }
  const load = (file) => {
    const f = path.resolve(__dirname, file),
      m = new Module(f, module)
    m.paths = Module._nodeModulePaths(path.dirname(f))
    const orig = m.require.bind(m)
    m.require = (id) =>
      id.endsWith('/overviewApi')
        ? mocks
        : id.endsWith('/datasetApi')
        ? {
            fetchDatasets:
              mocks.fetchDatasets ||
              (async () => ({
                items: [dataset('a'), dataset('b')].map((d) => ({ ...d, preview: null })),
                total: 2,
              })),
            fetchDataset: async (id) => dataset(id),
          }
        : id.startsWith('.')
        ? load(path.resolve(path.dirname(f), id + '.ts'))
        : orig(id)
    m._compile(
      ts.transpileModule(fs.readFileSync(f, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
      }).outputText,
      f
    )
    return m.exports
  }
  return load('../src/store/ionosphere/overview.ts').useOverviewStore()
}
test('homepage never derives TEC or F2 from non-electron-density scalar data', async () => {
  const s = setup({
    fetchOverviewFrame: async (id, i) => {
      const r = frame(id, i)
      r.metadata.parameter = 'Te'
      r.metadata.unit = 'K'
      return r
    },
  })
  await s.initialize()
  assert.equal(s.volume, null)
  assert.equal(s.analysis, null)
  assert.match(s.error, /电子密度/)
  s.dispose()
})
test('overview selects real dataset, preserves point across times and clears on source switch', async () => {
  const s = setup()
  await s.initialize()
  assert.equal(s.datasetId, 'a')
  assert.equal(s.frame.timeIndex, 0)
  s.pick(0, 0)
  assert.ok(s.profile.tec > 0)
  const first = s.profile.tec
  await s.selectTime(1)
  assert.ok(s.profile.tec > first)
  assert.equal(s.trend.length, 2)
  await s.selectDataset('b')
  assert.equal(s.point, null)
  assert.equal(s.trend.length, 1)
  s.dispose()
  assert.equal(s.playing, false)
  assert.equal(s.frame, null)
})
test('obsolete frame response and post-dispose response cannot replace latest state', async () => {
  const pending = []
  const s = setup({
    fetchOverviewFrame: (id, i, signal) =>
      new Promise((resolve) => pending.push({ id, i, signal, resolve })),
  })
  const init = s.initialize()
  await new Promise((r) => setTimeout(r, 0))
  pending[0].resolve(frame('a', 0))
  await init
  s.pick(0, 0)
  assert.ok(s.profile)
  const old = s.selectTime(1),
    newer = s.selectTime(2)
  assert.equal(s.frame, null)
  assert.equal(s.volume, null)
  assert.equal(s.analysis, null)
  assert.equal(s.profile, null)
  assert.deepEqual(s.point, { longitude: 0, latitude: 0 })
  assert.equal(s.trend.length, 1)
  assert.equal(pending[1].signal.aborted, true)
  pending[2].resolve(frame('a', 2))
  await newer
  pending[1].resolve(frame('a', 1))
  await old
  assert.equal(s.frame.timeIndex, 2)
  const next = s.selectTime(0)
  s.dispose()
  pending[3].resolve(frame('a', 0))
  await next
  assert.equal(s.frame, null)
})
test('playback refuses last frame and failed initial load', async () => {
  const s = setup()
  await s.initialize()
  await s.selectTime(2)
  s.togglePlay()
  assert.equal(s.playing, false)
  s.dispose()
  const failed = setup({
    fetchOverviewFrame: async () => {
      throw new Error('file unavailable')
    },
  })
  await failed.initialize()
  assert.equal(failed.frame, null)
  assert.match(failed.error, /file unavailable/)
  failed.togglePlay()
  assert.equal(failed.playing, false)
  failed.dispose()
})
test('invalid grid units, timestamp and float32 overflow cannot publish a frame', async () => {
  for (const change of [
    (f) => {
      f.metadata.unit = 'cm^-3'
    },
    (f) => {
      f.metadata.timestamp = '2019-04-26T00:00:00Z'
    },
    (f) => {
      f.values[0] = 1e300
    },
  ]) {
    const s = setup({
      fetchOverviewFrame: async (id, i) => {
        const f = frame(id, i)
        change(f)
        return f
      },
    })
    await s.initialize()
    assert.equal(s.frame, null)
    assert.ok(s.error)
    s.dispose()
  }
})
test('dispose clears private catalog as well as scientific frames', async () => {
  const s = setup()
  await s.initialize()
  s.dispose()
  assert.deepEqual(s.datasets, [])
  assert.equal(s.datasetId, '')
  assert.equal(s.totalDatasets, 0)
})
test('empty catalog refresh clears trend and cancels an older pending frame', async () => {
  let empty = false,
    finish
  const s = setup({
    fetchDatasets: async () => ({ items: empty ? [] : [dataset('a')], total: empty ? 0 : 1 }),
    fetchOverviewFrame: (id, i) =>
      i === 0
        ? Promise.resolve(frame(id, i))
        : new Promise((r) => {
            finish = r
          }),
  })
  await s.initialize()
  s.pick(10, 20)
  const old = s.selectTime(1)
  empty = true
  await s.initialize()
  assert.equal(s.frame, null)
  assert.equal(s.point, null)
  assert.deepEqual(s.trend, [])
  finish(frame('a', 1))
  await old
  assert.equal(s.frame, null)
  s.dispose()
})
test('playback waits for completion, allows stopping a pending frame, and stops at the end', async (t) => {
  t.mock.timers.enable(['setTimeout'])
  const pending = [],
    calls = []
  const s = setup({
    fetchOverviewFrame: (id, i) => {
      calls.push(i)
      return i === 0
        ? Promise.resolve(frame(id, i))
        : new Promise((resolve) => pending.push(() => resolve(frame(id, i))))
    },
  })
  try {
    await s.initialize()
    s.togglePlay()
    t.mock.timers.tick(1200)
    assert.equal(s.loading, true)
    assert.deepEqual(calls, [0, 1])
    t.mock.timers.tick(12000)
    assert.deepEqual(calls, [0, 1])
    s.togglePlay()
    assert.equal(s.playing, false)
    pending.shift()()
    await Promise.resolve()
    await Promise.resolve()
    t.mock.timers.tick(12000)
    assert.deepEqual(calls, [0, 1])
    assert.equal(s.frame.timeIndex, 1)
    s.togglePlay()
    t.mock.timers.tick(1200)
    assert.deepEqual(calls, [0, 1, 2])
    pending.shift()()
    await Promise.resolve()
    await Promise.resolve()
    assert.equal(s.frame.timeIndex, 2)
    assert.equal(s.playing, false)
  } finally {
    s.dispose()
    t.mock.timers.reset()
  }
})
