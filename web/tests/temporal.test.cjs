const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'),
  ts = require('typescript')
require.extensions['.ts'] = (m, f) =>
  m._compile(
    ts.transpileModule(fs.readFileSync(f, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText,
    f
  )
function api() {
  assert.ok(fs.existsSync('src/utils/ionosphere/temporal.ts'), 'temporal core must exist')
  return require('../src/utils/ionosphere/temporal.ts')
}
const times = [0, 1, 3].map((hour, index) => ({ index, timestamp: `2019-04-25T0${hour}:00:00Z` }))
const dataset = () => ({
  id: 'file',
  preview: { times: [...times] },
  imports: [
    {
      id: 'a',
      datasetId: 'file',
      timeIndex: 0,
      timestamp: times[0].timestamp,
      status: 'ready',
      createdAt: '2020-01-01',
    },
    {
      id: 'pending',
      datasetId: 'file',
      timeIndex: 1,
      timestamp: times[1].timestamp,
      status: 'processing',
    },
    {
      id: 'c',
      datasetId: 'file',
      timeIndex: 2,
      timestamp: times[2].timestamp,
      status: 'ready',
      createdAt: '2020-01-01',
    },
  ],
})
test('time slots keep source gaps, sort UTC, and select newest ready task only', () => {
  const d = dataset()
  d.imports.push({ ...d.imports[0], id: 'new', createdAt: '2021-01-01' })
  d.preview.times.reverse()
  const s = api().timeSlots(d, Date.parse(times[0].timestamp), Date.parse(times[2].timestamp))
  assert.deepEqual(
    s.map((s) => s.task?.id),
    ['new', undefined, 'c']
  )
  assert.equal(s[1].status, 'processing')
  assert.equal(s[2].milliseconds - s[1].milliseconds, 7200000)
  assert.equal(s[1].right - s[1].left, 5400000)
})
test('invalid windows, duplicate timestamps and large windows fail explicitly', () => {
  assert.throws(() => api().timeSlots(dataset(), 2, 1), /时间/)
  const d = dataset()
  d.preview.times.push({ index: 3, timestamp: times[0].timestamp })
  assert.throws(() => api().timeSlots(d, 0, Date.now()), /重复/)
  d.preview.times = Array.from({ length: 257 }, (_, index) => ({
    index,
    timestamp: new Date(index * 1000).toISOString(),
  }))
  assert.throws(() => api().timeSlots(d, 0, Date.now()), /256/)
})
const axis = (min, max, count) => ({ min, max, count, step: (max - min) / count })
const volume = () => ({
  metadata: {
    longitude: axis(-180, 180, 4),
    latitude: axis(-60, 60, 2),
    altitude: axis(100, 500, 4),
    noDataValue: -999,
  },
  values: new Float32Array(32).fill(20),
})
const conditions = { longitude: 0, latitude: 0, altitude: 300, heights: [100, 500], region: null }
test('summary shares sampling and arithmetic statistics; zero and missing stay distinct', () => {
  const v = volume()
  const s = api().summarize(v, conditions)
  assert.equal(s.point, 20)
  assert.equal(s.mean, 20)
  assert.equal(s.maximum, 20)
  assert.equal(s.count, 32)
  assert.equal(s.profile.length, 64)
  assert.ok(s.profile.every((x) => Math.abs(x - 20) < 1e-12))
  v.values.fill(0)
  assert.equal(api().summarize(v, conditions).point, 0)
  v.values.fill(-999)
  const missing = api().summarize(v, conditions)
  assert.equal(missing.mean, null)
  assert.equal(missing.point, null)
  assert.ok(missing.profile.every((x) => x === null))
  assert.throws(() => api().summarize(v, { ...conditions, latitude: 100 }), /经纬度/)
})

test('summary exposes actual imported-grid coverage without extrapolating source heights', () => {
  const v = volume()
  v.metadata.validDomain = {latitudeMin:-60,latitudeMax:60,altitudeMin:120,altitudeMax:450}
  const s = api().summarize(v,{...conditions,heights:[100,1000]})
  assert.deepEqual(s.coverage,[120,450])
  assert.equal(s.profile[0],null)
  assert.equal(s.profile[63],null)
})
test('plots use physical UTC spacing, break gaps and share one heat scale', () => {
  api()
  assert.ok(fs.existsSync('src/utils/ionosphere/temporalPlot.ts'), 'temporal plot must exist')
  const { temporalPlot } = require('../src/utils/ionosphere/temporalPlot.ts')
  const slots = api().timeSlots(
    dataset(),
    Date.parse(times[0].timestamp),
    Date.parse(times[2].timestamp)
  )
  const rows = slots.map((s, i) => ({
    ...s,
    point: i === 1 ? null : i + 1,
    mean: i === 1 ? null : 0,
    maximum: i === 1 ? null : 4,
    profile: i === 1 ? [] : [i + 1, 4],
  }))
  const p = temporalPlot(rows, [100, 500], 'linear')
  assert.equal((p.series[0].path.match(/M/g) || []).length, 2)
  assert.equal((p.series[0].path.match(/L/g) || []).length, 0)
  assert.equal(p.cells.length, 4)
  assert.ok(p.cells[0].width < 250)
  assert.equal(p.minimum, 1)
  assert.equal(p.maximum, 4)
  assert.ok(p.series[1].points.every((p) => Number.isFinite(p.y)))
  const one = temporalPlot([rows[0]], [100, 500], 'log')
  assert.ok(one.cells.every((c) => Number.isFinite(c.x) && Number.isFinite(c.width)))
  assert.equal(one.series[1].points.length, 0)
})
