const { test } = require('node:test'),
  assert = require('node:assert/strict')
const fs = require('node:fs'),
  path = require('node:path'),
  ts = require('typescript'),
  Module = require('node:module')
const { createPinia, setActivePinia } = require('pinia')
const axis = (min, max, count) => ({ min, max, count, step: (max - min) / count })
const tasks = ['a', 'b'].map((id, i) => ({
  id,
  status: 'ready',
  timestamp: `2019-04-25T0${i}:00:00Z`,
}))
const frame = (id) => ({
  metadata: {
    id,
    timestamp: tasks.find((t) => t.id === id).timestamp,
    longitude: axis(-180, 180, 4),
    latitude: axis(-60, 60, 2),
    altitude: axis(100, 500, 4),
  },
  values: new Float32Array(32).fill(id === 'a' ? 10 : 20),
})
function setup(overrides = {}) {
  setActivePinia(createPinia())
  const mocks = {
    fetchDataset: async () => ({ id:'file', imports:[...tasks, {id:'pending',status:'processing'}] }),
    fetchDatasets: async () => ({
      items: [{ id: 'file', imports: [...tasks, { id: 'pending', status: 'processing' }] }],
      total: 1,
    }),
    fetchVolume: async (_r, _s, _source, id) => frame(id),
    ...overrides,
  }
  const cache = new Map()
  function load(file) {
    const f = path.resolve(file)
    if (cache.has(f)) return cache.get(f).exports
    assert.ok(fs.existsSync(f), 'analysis store must exist')
    const m = new Module(f, module)
    cache.set(f, m)
    m.paths = Module._nodeModulePaths(path.dirname(f))
    const original = m.require.bind(m)
    m.require = (id) =>
      /\/(datasetApi|ionosphereApi)$/.test(id)
        ? mocks
        : id.startsWith('.')
        ? load(path.resolve(path.dirname(f), id + '.ts'))
        : original(id)
    m._compile(
      ts.transpileModule(fs.readFileSync(f, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
      }).outputText,
      f
    )
    return m.exports
  }
  return load(path.resolve(__dirname, '../src/store/ionosphere/analysis.ts')).useAnalysisStore()
}
test('analysis loads only a ready import and rejects unknown tasks without fallback', async () => {
  const calls = [],
    s = setup({
      fetchVolume: async (r, signal, source, id) => {
        calls.push([r, source, id])
        return frame(id)
      },
    })
  await s.initialize('a')
  assert.equal(s.statistics.mean, 10)
  assert.deepEqual(calls, [['standard', 'sami3', 'a']])
  await s.selectImport('pending')
  assert.equal(s.volume, null)
  assert.ok(s.error)
  await s.initialize('unknown')
  assert.equal(s.volume, null)
  assert.equal(calls.length, 1)
  await s.initialize()
  assert.equal(s.statistics.mean, 20)
  s.dispose()
  assert.equal(s.volume, null)
  assert.deepEqual(s.catalog.items, [])
})
test('clearing selection and empty catalog do not load a default sample', async () => {
  let calls = 0
  const s = setup({
    fetchDatasets: async () => ({ items: [], total: 0 }),
    fetchVolume: async () => {
      calls++
      return frame('a')
    },
  })
  await s.initialize()
  assert.equal(calls, 0)
  assert.equal(s.statistics, null)
  const s2 = setup()
  await s2.initialize('a')
  await s2.selectImport(undefined)
  assert.equal(s2.volume, null)
  assert.equal(s2.importId, undefined)
})
test('superseded binary load and disposed load cannot publish stale results', async () => {
  const pending = [],
    s = setup({
      fetchVolume: (_r, signal, _source, id) =>
        new Promise((resolve) => pending.push({ signal, id, resolve })),
    })
  const a = s.initialize('a')
  await new Promise((r) => setTimeout(r, 0))
  const b = s.selectImport('b')
  assert.equal(pending[0].signal.aborted, true)
  pending[1].resolve(frame('b'))
  await b
  pending[0].resolve(frame('a'))
  await a
  assert.equal(s.statistics.mean, 20)
  const next = s.selectImport('a')
  s.dispose()
  pending[2].resolve(frame('a'))
  await next
  assert.equal(s.volume, null)
})
test('mismatched timestamp is rejected, invalid bounds do not silently change region', async () => {
  const bad = setup({ fetchVolume: async () => frame('b') })
  await bad.initialize('a')
  assert.equal(bad.volume, null)
  assert.match(bad.error, /时刻/)
  const s = setup()
  await s.initialize('a')
  assert.equal(s.applyBounds(null, [400, 200]), false)
  assert.deepEqual(s.heights, [100, 500])
  assert.equal(s.applyBounds({ west: 0, east: 0, south: 0, north: 10 }, [100, 500]), false)
  assert.equal(s.applyBounds({ west: -100, east: 100, south: -60, north: 60 }, [200, 400]), true)
  assert.equal(s.pick(0, 0), true)
  assert.equal(s.profile.values[0], 10)
  assert.equal(s.pick(150, 0), false)
  assert.equal(s.point.longitude, 0)
  await s.selectImport('b')
  assert.equal(s.point.longitude, 0)
  assert.equal(s.profile.values[0], 20)
})
test('temperature imports never reach Ne statistics', async () => {
  let calls=0
  const d={id:'file',preview:{parameters:[]},imports:[{...tasks[0],parameter:'Te'}]}
  const s=setup({fetchDatasets:async()=>({items:[d],total:1}),fetchDataset:async()=>d,fetchVolume:async()=>{calls++;return frame('a')}})
  await s.initialize('a');assert.equal(calls,0);assert.equal(s.statistics,null);assert.match(s.error,/仅支持电子密度/);s.dispose()
})
