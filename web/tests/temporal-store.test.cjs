const { test } = require('node:test'),
  assert = require('node:assert/strict')
const fs = require('node:fs'),
  path = require('node:path'),
  ts = require('typescript'),
  Module = require('node:module')
const { createPinia, setActivePinia } = require('pinia')
const times = Array.from({ length: 3 }, (_, index) => ({
  index,
  timestamp: `2019-04-25T0${index}:00:00Z`,
}))
const dataset = {
  id: 'file',
  preview: { times, bounds: { altitude: [100, 500], longitude: [-180, 180], latitude: [-60, 60] } },
  imports: times.map((t, i) => ({
    id: String(i),
    datasetId: 'file',
    timeIndex: i,
    timestamp: t.timestamp,
    status: i === 1 ? 'processing' : 'ready',
    createdAt: '2020-01-01',
  })),
}
const axis = (min, max, count) => ({ min, max, count, step: (max - min) / count })
const frame = (id) => ({
  metadata: {
    timestamp: times[Number(id)].timestamp,
    longitude: axis(-180, 180, 4),
    latitude: axis(-60, 60, 2),
    altitude: axis(100, 500, 4),
  },
  values: new Float32Array(32).fill(Number(id) + 10),
})
test('temporal analysis rejects a mismatched physical parameter instead of reporting temperature as Ne',async()=>{
 const s=setup({fetchVolume:async(_r,_s,_source,id)=>{const v=frame(id);v.metadata.parameter='Te';return v}})
 await s.initialize('file');await s.run();assert.equal(s.rows[0].status,'error');assert.match(s.rows[0].error,/电子密度/);assert.equal(s.rows[0].mean,null);s.dispose()
})
function setup(overrides = {}) {
  setActivePinia(createPinia())
  const mocks = {
    fetchDatasets: async () => ({ items: [dataset], total: 1 }),
    fetchDataset: async () => dataset,
    fetchVolume: async (_r, _s, _source, id) => frame(id),
    ...overrides,
  }
  const cache = new Map()
  function load(f) {
    if (cache.has(f)) return cache.get(f).exports
    assert.ok(fs.existsSync(f), 'temporal store must exist')
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
  return load(path.resolve(__dirname, '../src/store/ionosphere/temporal.ts')).useTemporalStore()
}
test('only ready imports are read sequentially with exact source and timestamps', async () => {
  let active = 0,
    max = 0
  const calls = []
  const s = setup({
    fetchVolume: async (r, signal, source, id) => {
      active++
      max = Math.max(max, active)
      calls.push([r, source, id])
      await new Promise((r) => setTimeout(r, 1))
      active--
      return frame(id)
    },
  })
  await s.initialize('file')
  await s.run()
  assert.deepEqual(calls, [
    ['standard', 'sami3', '0'],
    ['standard', 'sami3', '2'],
  ])
  assert.equal(max, 1)
  assert.deepEqual(
    s.rows.map((r) => r.point),
    [10, null, 12]
  )
  assert.equal(s.rows[1].status, 'processing')
  assert.equal(s.completed, 2)
  assert.equal(s.running, false)
})
test('bad frame timestamp stays blank, next valid frame continues', async () => {
  const s = setup({ fetchVolume: async () => frame('2') })
  await s.initialize('file')
  await s.run()
  assert.equal(s.rows[0].status, 'error')
  assert.match(s.rows[0].error, /时刻/)
  assert.equal(s.rows[0].mean, null)
  assert.equal(s.rows[2].point, 12)
})
test('condition changes, cancellation and disposal reject late results', async () => {
  const pending = []
  const s = setup({
    fetchVolume: (_r, signal, _source, id) =>
      new Promise((resolve) => pending.push({ signal, id, resolve })),
  })
  await s.initialize('file')
  const run = s.run()
  s.conditions.longitude = 20
  assert.equal(pending[0].signal.aborted, true)
  assert.deepEqual(s.rows, [])
  pending[0].resolve(frame('0'))
  await run
  assert.deepEqual(s.rows, [])
  const next = s.run()
  s.cancel()
  pending[1].resolve(frame('0'))
  await next
  assert.ok(s.rows.every((r) => r.point === null))
  assert.equal(s.running, false)
  const third = s.run()
  s.dispose()
  pending[2].resolve(frame('0'))
  await third
  assert.deepEqual(s.rows, [])
  assert.equal(s.dataset, null)
})
test('unknown file and invalid conditions never trigger volume requests', async () => {
  let calls = 0
  const s = setup({
    fetchVolume: async () => {
      calls++
      return frame('0')
    },
  })
  await s.initialize('missing')
  assert.ok(s.error)
  await s.run()
  assert.equal(calls, 0)
  await s.initialize('file')
  s.conditions.latitude = 100
  await s.run()
  assert.match(s.error, /经纬度/)
  assert.equal(calls, 0)
})
test('switching files aborts old detail and cannot publish stale selection', async () => {
  const pending = []
  const s = setup({
    fetchDataset: (id, signal) => new Promise((resolve) => pending.push({ id, signal, resolve })),
  })
  const first = s.initialize('file')
  await new Promise((r) => setTimeout(r, 0))
  const second = s.selectDataset('file')
  assert.equal(pending[0].signal.aborted, true)
  pending[1].resolve(dataset)
  await second
  pending[0].resolve({ ...dataset, id: 'old' })
  await first
  assert.equal(s.dataset.id, 'file')
})

test('batch navigation applies an exact UTC window and rejects malformed bounds',async()=>{
  const s=setup();await s.initialize('file')
  assert.equal(typeof s.applyTimeWindow,'function')
  assert.equal(s.applyTimeWindow(times[0].timestamp,times[0].timestamp),true)
  assert.equal(s.windowSlots.length,1)
  await s.run();assert.equal(s.rows.length,1)
  assert.equal(s.applyTimeWindow('bad',times[2].timestamp),false)
  assert.deepEqual(s.rows,[]);assert.ok(s.error)
})
