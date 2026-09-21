const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (m, f) =>
  m._compile(
    ts.transpileModule(fs.readFileSync(f, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText,
    f
  )
const { defaultSettings } = require('../src/models/ionosphere/IonosphereVolume.ts')
const metadata = {
  source: 'sami3-model',
  longitude: { min: -180, max: 180, count: 60, step: 6 },
  latitude: { min: -90, max: 90, count: 72, step: 2.5 },
  altitude: { min: 90, max: 1000, count: 48, step: 910 / 48 },
  minValue: 1e8,
  maxValue: 1e12,
}
const settings = () => ({
  ...defaultSettings(metadata),
  region: { west: 114, east: 122, south: 34, north: 40.5 },
  volumeVisible: false,
  sliceVisible: true,
  sliceMode: 'multiple',
  sliceAltitudes: [100, 200, 300, 400],
})
test('SAMI3 config synchronizes the shared regional context even with its volume hidden', () => {
  const {
    CesiumVoxelRenderer,
  } = require('../src/cesium/ionosphere/renderer/CesiumVoxelRenderer.ts')
  const updates = [],
    sectionUpdates = []
  const renderer = {
    volume: { metadata },
    primitive: {},
    shader: { setUniform() {} },
    slice: { update() {} },
    regionalContext: {
      update(...args) {
        updates.push(args)
      },
    },
    marker: { removeAll() {} },
    events: { diagnostics() {} },
    viewer: { scene: { requestRender() {} } },
    setAltitudeRange() {},
    setValueRange() {},
    setOpacity() {},
    setQuality() {},
  }
  renderer.sections = {
    update(...args) {
      sectionUpdates.push(args)
    },
  }
  CesiumVoxelRenderer.prototype.configure.call(renderer, settings())
  assert.equal(updates.length, 1)
  assert.equal(updates[0][0].metadata.source, 'sami3-model')
  assert.equal(sectionUpdates.length, 1)
})
test('shared presentation follows visible slice heights, data domain and optional volume', () => {
  const file = '../src/cesium/ionosphere/renderer/regionalPresentation.ts'
  assert.ok(fs.existsSync(require('node:path').resolve(__dirname, file)))
  const { regionalPresentation } = require(file)
  const s = settings()
  assert.deepEqual(regionalPresentation(metadata, s).heights, [100, 400])
  assert.equal(regionalPresentation(metadata, s).province, false)
  assert.equal(regionalPresentation({ ...metadata, source: 'shandong-mock' }, s).province, true)
  s.altitudeRange = [90, 300]
  assert.deepEqual(regionalPresentation(metadata, s).heights, [100, 300])
  s.volumeVisible = true
  assert.deepEqual(regionalPresentation(metadata, s).heights, [90, 300])
  s.region = { west: 170, east: -170, south: 34, north: 40 }
  assert.equal(regionalPresentation(metadata, s).province, false)
  s.region = null
  assert.equal(regionalPresentation(metadata, s), null)
  s.region = settings().region
  s.volumeVisible = false
  s.sliceVisible = false
  assert.equal(regionalPresentation(metadata, s), null)
  s.section.visible = true
  assert.deepEqual(regionalPresentation(metadata, s).heights, s.altitudeRange)
})
test('regional scene resources are reused, replaced across geographic contexts, and cleared', async () => {
  const C = await import('cesium')
  const { RegionalContext } = require('../src/cesium/ionosphere/renderer/RegionalContext.ts')
  const viewer = {
    isDestroyed: () => false,
    scene: { primitives: new C.PrimitiveCollection(), skyBox: { show: true }, requestRender() {} },
    imageryLayers: { remove() {} },
    creditDisplay: { removeStaticCredit() {} },
  }
  const context = new RegionalContext(C, viewer, () => {})
  const loads = []
  context.load = async (province) => {
    loads.push(province)
    context.previousSkybox = viewer.scene.skyBox.show
    viewer.scene.skyBox.show = false
  }
  const s = settings()
  context.update({ metadata }, s)
  assert.deepEqual(loads, [false])
  assert.equal(context.envelope.length, 2)
  const first = context.envelope.get(0)
  context.update({ metadata }, { ...s, opacity: 0.4 })
  assert.equal(context.envelope.get(0), first)
  context.update({ metadata }, { ...s, region: { west: 132, east: 138, south: 5, north: 12 } })
  // Both regions use the same generic context; only envelope geometry changes.
  assert.deepEqual(loads, [false])
  assert.equal(first.isDestroyed(), true)
  context.update({ metadata }, { ...s, region: null })
  assert.equal(context.envelope.length, 0)
  assert.equal(viewer.scene.skyBox.show, true)
  context.destroy()
  assert.equal(viewer.scene.primitives.length, 0)
})
