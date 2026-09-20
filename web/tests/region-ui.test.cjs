const ts = require('typescript')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createPinia, setActivePinia } = require('pinia')
const { nextTick } = require('vue')
const { parse, compileScript, compileTemplate } = require('vue/compiler-sfc')

function load(file, imports = {}) {
  const filename = path.resolve(__dirname, file)
  const loaded = new Module(filename, module)
  loaded.paths = Module._nodeModulePaths(path.dirname(filename))
  const originalRequire = loaded.require.bind(loaded)
  loaded.require = (id) => {
    if (Object.hasOwn(imports, id)) return imports[id]
    const relative = path.resolve(path.dirname(filename), `${id}.ts`)
    return id.startsWith('.') && fs.existsSync(relative) ? load(relative) : originalRequire(id)
  }
  loaded._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText,
    filename
  )
  return loaded.exports
}
function setup() {
  setActivePinia(createPinia())
  const controllers = []
  class Controller {
    constructor(_renderer, events) {
      this.events = events
      this.calls = []
      controllers.push(this)
    }
    initialize(...args) {
      this.calls.push(['initialize', ...args])
    }
    load(...args) {
      this.calls.push(['load', ...args])
    }
    clear() {
      this.calls.push(['clear'])
    }
    configure(settings) {
      this.configured = settings
    }
    destroy() {
      this.calls.push(['destroy'])
    }
    beginRegionSelection() {
      this.calls.push(['draw'])
    }
    cancelRegionSelection() {
      this.calls.push(['cancel'])
    }
    focusRegion() {
      this.calls.push(['focus'])
    }
    beginSectionSelection() {
      this.calls.push(['drawSection'])
    }
    cancelSectionSelection() {
      this.calls.push(['cancelSection'])
    }
    markSample(point) {
      this.marked = point
    }
  }
  const model = load('../src/models/ionosphere/IonosphereVolume.ts')
  const { useVolumeStore } = load('../src/store/ionosphere/volume.ts', {
    '../../models/ionosphere/IonosphereVolume': model,
    '../../cesium/ionosphere/IonosphereVolumeController': {
      IonosphereVolumeController: Controller,
    },
  })
  const store = useVolumeStore()
  store.attach({})
  const ready = () => {
    controllers
      .at(-1)
      .events.data(
        {
          metadata: {
            source: 'deterministic-mock',
            altitude: { min: 80, max: 1000 },
            minValue: 1,
            maxValue: 10,
          },
        },
        10
      )
    store.rendererEvents.ready()
  }
  return { store, controllers, ready }
}
test('scientific slice preset keeps source, numeric range and selected region', async () => {
  const { store, ready } = setup()
  ready()
  store.source = 'sami3'
  store.settings.region = { west: -166.8, east: -160.7, south: 0.7, north: 5.9 }
  const region = { ...store.settings.region },
    range = [...store.settings.valueRange]
  assert.equal(typeof store.useScientificSlices, 'function')
  store.useScientificSlices()
  assert.equal(store.source, 'sami3')
  assert.deepEqual(store.settings.region, region)
  assert.deepEqual(store.settings.valueRange, range)
  assert.deepEqual(store.settings.sliceAltitudes, [100, 200, 300, 400])
  assert.deepEqual(store.settings.altitudeRange, [100, 400])
  assert.equal(store.settings.volumeVisible, false)
  assert.equal(store.settings.normalization, 'linear')
  assert.equal(store.settings.opacity, 0.45)
  assert.equal(store.selectShandongRegion, undefined)
  await nextTick()
  store.detach()
})
test('production store never loads a demo when no import is selected and clears removed selection', () => {
  const { store, controllers } = setup()
  assert.equal(
    controllers[0].calls.some(([name]) => name === 'initialize' || name === 'load'),
    false
  )
  assert.equal(store.loading, false)
  store.selectImport('managed-task')
  assert.deepEqual(controllers[0].calls.at(-1), ['load', 'standard', 'sami3', 'managed-task'])
  store.selectImport(undefined)
  assert.equal(controllers[0].calls.at(-1)[0], 'clear')
  assert.equal(store.metadata, null)
  assert.equal(store.loading, false)
  store.detach()
})
test('catalog rejection blocks reload until an explicit task is selected again',()=>{
 const {store,controllers}=setup();store.selectImport('managed-task');store.clearSelection()
 const count=controllers[0].calls.filter(([name])=>name==='load').length
 store.reload();assert.equal(controllers[0].calls.filter(([name])=>name==='load').length,count)
 store.selectImport('managed-task');assert.equal(controllers[0].calls.filter(([name])=>name==='load').length,count+1)
 store.detach()
})
test('mode transitions preserve multiple slices for a volume overlay', async () => {
  const { store } = setup()
  store.setMode('multi-height-slice')
  assert.equal(store.settings.sliceMode, 'multiple')
  assert.equal(store.settings.sliceVisible, true)
  assert.equal(store.settings.volumeVisible, false)
  store.setMode('volume')
  assert.equal(store.settings.sliceMode, 'multiple')
  assert.equal(store.settings.volumeVisible, true)
  assert.equal(store.settings.sliceVisible, false)
  store.settings.sliceVisible = true
  assert.equal(store.settings.sliceMode, 'multiple')
  store.setMode('height-slice')
  assert.equal(store.settings.sliceMode, 'single')
  await nextTick()
  store.detach()
})
test('fixed sections enable vertical curtain without changing source or horizontal heights', async () => {
  const { store, ready } = setup()
  ready()
  store.settings.region = { west: 114, east: 122, south: 34, north: 40.5 }
  const heights = [...store.settings.sliceAltitudes],
    range = [...store.settings.valueRange]
  store.setMode('longitude-section')
  assert.equal(store.settings.section?.kind, 'longitude')
  assert.equal(store.settings.section.visible, true)
  assert.equal(store.settings.section.longitude, 118)
  assert.equal(store.settings.volumeVisible, false)
  assert.deepEqual(store.settings.sliceAltitudes, heights)
  assert.deepEqual(store.settings.valueRange, range)
  store.setMode('latitude-section')
  assert.equal(store.settings.section.kind, 'latitude')
  assert.equal(store.settings.section.latitude, 37.25)
  store.setMode('volume')
  assert.equal(store.settings.section.visible, false)
  await nextTick()
  store.detach()
})
test('section positions sanitize nonfinite drafts and reset hides vertical curtain', () => {
  const model = load('../src/models/ionosphere/IonosphereVolume.ts')
  const defaults = model.defaultSettings()
  assert.equal(defaults.section?.visible, false)
  const result = model.sanitizeSettings({
    ...defaults,
    section: { kind: 'longitude', longitude: NaN, latitude: 100, path: null, visible: true },
  })
  assert.ok(Number.isFinite(result.section.longitude))
  assert.equal(result.section.latitude, 90)
})
test('fixed section follows the effective geographic domain after region changes', () => {
  const model = load('../src/models/ionosphere/IonosphereVolume.ts')
  const m = {
    longitude: { min: 114, max: 122 },
    latitude: { min: 34, max: 40.5 },
    altitude: { min: 100, max: 400 },
    minValue: 1,
    maxValue: 100,
  }
  const s = {
    ...model.defaultSettings(m),
    region: { west: 120, east: 130, south: 38, north: 45 },
    section: { kind: 'longitude', longitude: 118, latitude: 0, path: null, visible: true },
  }
  const safe = model.sanitizeSettings(s, m)
  assert.equal(safe.section.longitude, 121)
  assert.equal(safe.section.latitude, 38)
})
test('drawing commits only a successful region, cancel preserves previous region, clear removes probe', async () => {
  const { store, controllers, ready } = setup()
  assert.equal(typeof store.drawRegion, 'function')
  store.drawRegion()
  assert.equal(
    controllers[0].calls.some(([call]) => call === 'draw'),
    false
  )
  ready()
  const previous = { west: 100, south: 10, east: 120, north: 30 }
  store.settings.region = previous
  store.drawRegion()
  assert.equal(store.drawingRegion, true)
  assert.deepEqual(store.settings.region, previous)
  store.rendererEvents.regionHint('选择第二个角点')
  assert.equal(store.regionHint, '选择第二个角点')
  store.cancelRegion()
  assert.equal(store.drawingRegion, false)
  assert.deepEqual(store.settings.region, previous)
  store.drawRegion()
  store.selectedPoint = { value: 3 }
  const region = { west: 170, south: -10, east: -170, north: 10 }
  store.rendererEvents.regionSelected(region)
  assert.deepEqual(store.settings.region, region)
  assert.equal(store.selectedPoint, null)
  assert.equal(store.drawingRegion, false)
  store.focusRegion()
  assert.equal(controllers[0].calls.at(-1)[0], 'focus')
  store.selectedPoint = { value: 3 }
  store.clearRegion()
  assert.equal(store.settings.region, null)
  assert.equal(store.selectedPoint, null)
  await nextTick()
  store.detach()
})
test('reset, source reload and detach cancel drawing and ignore stale region callbacks', async () => {
  const { store, ready } = setup()
  assert.equal(typeof store.cancelRegion, 'function')
  ready()
  store.drawRegion()
  store.reset()
  assert.equal(store.drawingRegion, false)
  assert.equal(store.settings.region, null)
  store.drawRegion()
  store.selectImport('next-managed-task')
  assert.equal(store.drawingRegion, false)
  assert.equal(store.regionHint, '')
  store.rendererEvents.regionDrawing(true)
  assert.equal(store.drawingRegion, false)
  ready()
  store.drawRegion()
  await nextTick()
  store.detach()
  store.rendererEvents.regionDrawing(true)
  store.rendererEvents.regionHint('stale')
  store.rendererEvents.regionSelected({ west: 1, south: 2, east: 3, north: 4 })
  assert.equal(store.drawingRegion, false)
  assert.equal(store.regionHint, '')
  assert.equal(store.settings.region, null)
  store.attach({})
  ready()
  store.rendererEvents.regionDrawing(true)
  store.rendererEvents.regionHint('previous scene')
  store.rendererEvents.regionSelected({ west: 1, south: 2, east: 3, north: 4 })
  assert.equal(store.drawingRegion, false)
  assert.equal(store.regionHint, '')
  assert.equal(store.settings.region, null)
  await nextTick()
  store.detach()
})

function component(file, store) {
  const filename = path.resolve(__dirname, file)
  const { descriptor, errors } = parse(fs.readFileSync(filename, 'utf8'), { filename })
  assert.deepEqual(errors, [])
  const compiled = compileScript(descriptor, { id: 'region-ui' })
  assert.deepEqual(
    compileTemplate({ id: 'region-ui', source: descriptor.template.content, filename }).errors,
    []
  )
  const loaded = new Module(filename, module)
  loaded.paths = Module._nodeModulePaths(path.dirname(filename))
  loaded.require = (id) => {
    if (id === 'vue') return require('vue')
    if (id === '@/store/ionosphere/volume') return { useVolumeStore: () => store }
    if (id === '@/models/ionosphere/IonosphereVolume')
      return load('../src/models/ionosphere/IonosphereVolume.ts')
    if (id === '@/utils/ionosphere/normalize') return { scientific: String }
    if (id === '@/utils/ionosphere/region') return load('../src/utils/ionosphere/region.ts')
    if (id === 'vue-router') return { useRoute: () => ({ query: {} }) }
    return {}
  }
  loaded._compile(
    ts.transpileModule(compiled.content.replaceAll('import.meta.env.DEV', 'false'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText,
    filename
  )
  return loaded.exports.default.setup({}, { expose() {} })
}
test('height rows commit finite values, retain clipped heights, and respect one to four rows', async () => {
  const { store, ready } = setup()
  ready()
  store.settings.sliceAltitudes = [100, 200, 300, 400]
  const panel = component('../src/components/ionosphere/VolumeControlPanel.vue', store)
  assert.equal(typeof panel.commitSliceHeight, 'function')
  panel.addSliceHeight()
  assert.equal(store.settings.sliceAltitudes.length, 4)
  const invalid = { target: { valueAsNumber: NaN, value: '' } }
  panel.commitSliceHeight(0, invalid)
  assert.equal(store.settings.sliceAltitudes[0], 100)
  assert.equal(Number(invalid.target.value), 100)
  store.settings.altitudeRange = [200, 500]
  panel.commitSliceHeight(0, { target: { valueAsNumber: 150, value: '150' } })
  assert.equal(store.settings.sliceAltitudes[0], 150)
  panel.removeSliceHeight(3)
  panel.removeSliceHeight(2)
  panel.removeSliceHeight(1)
  panel.removeSliceHeight(0)
  assert.equal(store.settings.sliceAltitudes.length, 1)
  panel.addSliceHeight()
  assert.equal(store.settings.sliceAltitudes.length, 2)
  store.settings.sliceAltitudes = [1000]
  panel.addSliceHeight()
  assert.equal(store.settings.sliceAltitudes.length, 2)
  assert.ok(store.settings.sliceAltitudes.every(Number.isFinite))
  await nextTick()
  store.detach()
})
test('section controls keep a hidden section accessible and constrain dateline coordinates', async () => {
  const { store, ready } = setup()
  ready()
  store.metadata = {
    ...store.metadata,
    longitude: { min: -180, max: 180 },
    latitude: { min: -90, max: 90 },
  }
  store.settings.region = { west: 170, east: -170, south: 30, north: 40 }
  store.setMode('longitude-section')
  const panel = component('../src/components/ionosphere/SectionControls.vue', store)
  assert.deepEqual(panel.bounds.value, [170, 190])
  panel.commit({ target: { valueAsNumber: 185, value: '' } })
  assert.equal(store.settings.section.longitude, -175)
  assert.equal(panel.position.value, 185)
  panel.commit({ target: { valueAsNumber: NaN, value: '' } })
  assert.equal(store.settings.section.longitude, -175)
  store.settings.section.visible = false
  assert.match(
    fs.readFileSync(
      path.resolve(__dirname, '../src/components/ionosphere/SectionControls.vue'),
      'utf8'
    ),
    /displayMode.endsWith/
  )
  await nextTick()
  store.detach()
})
test('path drawing is exclusive, cancel preserves path and stale callbacks are ignored', async () => {
  const { store, ready, controllers } = setup()
  ready()
  const path = [
    { longitude: 115, latitude: 35 },
    { longitude: 120, latitude: 39 },
  ]
  assert.equal(typeof store.drawSection, 'function')
  store.settings.section.path = path
  store.drawRegion()
  store.drawSection()
  assert.equal(store.drawingRegion, false)
  assert.equal(store.drawingSection, true)
  store.cancelSection()
  assert.deepEqual(store.settings.section.path, path)
  store.rendererEvents.sectionSelected([
    { longitude: 0, latitude: 0 },
    { longitude: 1, latitude: 1 },
  ])
  assert.deepEqual(store.settings.section.path, path)
  store.drawSection()
  store.rendererEvents.sectionSelected(path)
  assert.equal(store.settings.section.kind, 'path')
  assert.equal(store.drawingSection, false)
  assert.equal(store.settings.displayMode, 'path-section')
  store.drawSection()
  store.drawRegion()
  assert.equal(store.drawingSection, false)
  await nextTick()
  store.detach()
  store.rendererEvents.sectionDrawing(true)
  assert.equal(store.drawingSection, false)
  assert.ok(controllers[0].calls.some((c) => c[0] === 'drawSection'))
})
test('2D picks use shared section grid and mark 3D; hidden or stale data cannot sample', async () => {
  const { store, ready, controllers } = setup()
  ready()
  store.settings.section.visible = true
  store.settings.valueRange = [1, 100]
  store.settings.probeEnabled = true
  store.rendererEvents.section({
    kind: 'longitude',
    columns: 2,
    rows: 2,
    positions: [
      { longitude: 118, latitude: 34 },
      { longitude: 118, latitude: 40 },
    ],
    distances: [0, 600],
    altitudes: [400, 100],
    values: new Float32Array([10, 30, 50, 70]),
  })
  assert.equal(typeof store.sampleSection, 'function')
  store.sampleSection(0.5, 0.5)
  assert.equal(store.selectedPoint.value, 40)
  assert.equal(store.selectedPoint.altitude, 250)
  assert.equal(store.selectedPoint.latitude, 37)
  assert.equal(store.selectedPoint.source, 'vertical-section')
  assert.deepEqual(controllers[0].marked, store.selectedPoint)
  store.settings.opacity = 0
  store.sampleSection(0.5, 0.5)
  assert.equal(store.selectedPoint, null)
  store.selectImport('next-managed-task')
  store.sampleSection(0.5, 0.5)
  assert.equal(store.sectionGrid, null)
  await nextTick()
  store.detach()
})
test('range modes propagate one regional range, hide empty domains and reset on new data', async () => {
  const { store, controllers } = setup(),
    controller = controllers[0]
  const axis = (min, max, count) => ({ min, max, count, step: (max - min) / count })
  const metadata = {
    id: 'range-store',
    source: 'deterministic-mock',
    longitude: axis(0, 4, 2),
    latitude: axis(0, 4, 2),
    altitude: axis(100, 500, 2),
    minValue: 10,
    maxValue: 80,
  }
  const volume = { metadata, values: Float32Array.from([10, 20, 30, 40, 50, 60, 70, 80]) }
  controller.events.data(volume, 1)
  store.rendererEvents.ready()
  store.settings.region = { west: 0, east: 1, south: 0, north: 1 }
  store.settings.altitudeRange = [100, 200]
  store.settings.rangeMode = 'region'
  await nextTick()
  await new Promise((r) => setTimeout(r, 120))
  assert.deepEqual(store.rangeStatistics.range, [10, 10])
  assert.ok(store.settings.valueRange[1] > 10)
  assert.deepEqual(controller.configured.valueRange, [...store.settings.valueRange])
  store.settings.region = { west: 20, east: 30, south: 0, north: 1 }
  await nextTick()
  await new Promise((r) => setTimeout(r, 120))
  assert.equal(store.rangeEmpty, true)
  assert.equal(controller.configured.volumeVisible, false)
  assert.equal(controller.configured.section.visible, false)
  store.settings.rangeMode = 'manual'
  store.settings.valueRange = [5, 95]
  await nextTick()
  await new Promise((r) => setTimeout(r, 120))
  assert.equal(store.rangeEmpty, false)
  assert.deepEqual(store.settings.valueRange, [5, 95])
  controller.events.data({ ...volume, metadata: { ...metadata, id: 'new-time' } }, 1)
  assert.equal(store.settings.rangeMode, 'global')
  assert.deepEqual(store.settings.valueRange, [10, 80])
  await nextTick()
  store.detach()
})
