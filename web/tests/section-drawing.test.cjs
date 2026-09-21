const ts = require('typescript')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { test } = require('node:test')
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, file)

async function setup(inputs = true) {
  const file = path.resolve(__dirname, '../src/cesium/ionosphere/interaction/SectionDrawing.ts')
  assert.ok(fs.existsSync(file), 'two-point section drawing exists')
  const { SectionDrawing } = require(file), C = await import('cesium')
  let handler, canceledFlights = 0, renders = 0
  class Handler {
    constructor() { handler = this; this.actions = new Map(); this.dead = false }
    setInputAction(fn, type) { this.actions.set(type, fn) }
    destroy() { this.actions.clear(); this.dead = true }
  }
  const primitives = new C.PrimitiveCollection(), keyboard = new EventTarget()
  const viewer = {
    canvas: { style: { cursor: 'grab' } },
    camera: { cancelFlight() { canceledFlights++ }, pickEllipsoid(pixel, ellipsoid) {
      assert.equal(ellipsoid, C.Ellipsoid.WGS84)
      return pixel.sky ? undefined : C.Cartesian3.fromDegrees(pixel.longitude, pixel.latitude)
    } },
    scene: { primitives, screenSpaceCameraController: { enableInputs: inputs }, requestRender() { renders++ } },
    isDestroyed: () => false,
  }
  const selected = [], active = [], hints = []
  const drawing = new SectionDrawing({ ...C, ScreenSpaceEventHandler: Handler,
    Material: { fromType: (_type, uniforms) => ({ uniforms, destroy() {} }) } }, viewer,
    { selected: p => selected.push(p), active: a => active.push(a), hint: h => hints.push(h) }, keyboard)
  return { C, drawing, viewer, primitives, selected, active, hints, handler, keyboard,
    canceledFlights: () => canceledFlights, renders: () => renders,
    click: p => handler.actions.get(C.ScreenSpaceEventType.LEFT_CLICK)?.({ position: p }),
    move: p => handler.actions.get(C.ScreenSpaceEventType.MOUSE_MOVE)?.({ endPosition: p }),
  }
}
test('two ground clicks commit endpoints once and restore camera controls and cursor', async () => {
  const f = await setup()
  f.click({ longitude: 1, latitude: 2 })
  assert.equal(f.selected.length, 0)
  f.drawing.start()
  assert.equal(f.drawing.active, true)
  assert.equal(f.canceledFlights(), 1)
  assert.equal(f.viewer.scene.screenSpaceCameraController.enableInputs, false)
  assert.equal(f.viewer.canvas.style.cursor, 'crosshair')
  f.click({ sky: true })
  assert.match(f.hints.at(-1), /地球|地面|表面/)
  f.click({ longitude: 118, latitude: 37 })
  assert.equal(f.selected.length, 0)
  f.click({ longitude: 121, latitude: 39 })
  assert.equal(f.selected.length, 1)
  for (const [i, expected] of [[0, [118, 37]], [1, [121, 39]]]) {
    assert.ok(Math.abs(f.selected[0][i].longitude - expected[0]) < 1e-8)
    assert.ok(Math.abs(f.selected[0][i].latitude - expected[1]) < 1e-8)
  }
  assert.equal(f.drawing.active, false)
  assert.equal(f.viewer.scene.screenSpaceCameraController.enableInputs, true)
  assert.equal(f.viewer.canvas.style.cursor, 'grab')
  assert.deepEqual(f.active, [true, false])
  assert.equal(f.primitives.length, 0)
  f.drawing.destroy()
})
test('preview uses one reusable geodesic polyline and is destroyed on completion', async () => {
  const f = await setup()
  f.drawing.start()
  f.click({ longitude: 179, latitude: 30 })
  f.move({ longitude: -179, latitude: 30 })
  assert.equal(f.primitives.length, 1)
  const collection = f.primitives.get(0), line = collection.get(0)
  assert.equal(collection.length, 1)
  assert.ok(line.positions.length > 2 && line.positions.length <= 513)
  const mid = f.C.Cartographic.fromCartesian(line.positions[Math.floor(line.positions.length / 2)])
  assert.ok(Math.abs(Math.abs(f.C.Math.toDegrees(mid.longitude)) - 180) < .02)
  assert.ok(f.C.Math.toDegrees(mid.latitude) > 30, 'geodesic bows poleward')
  for (let i = 0; i < 30; i++) f.move({ longitude: -179 + i / 100, latitude: 31 })
  assert.equal(f.primitives.length, 1)
  assert.equal(collection.length, 1)
  assert.equal(collection.get(0), line)
  f.move({ sky: true })
  assert.equal(line.show, false, 'sky clears misleading preview')
  f.move({ longitude: -178, latitude: 32 })
  assert.equal(line.show, true)
  f.click({ longitude: -178, latitude: 32 })
  assert.equal(f.primitives.length, 0)
  assert.equal(collection.isDestroyed(), true)
  assert.ok(f.renders() > 0)
  f.drawing.destroy()
})
test('near-coincident and antipodal endpoints keep drawing active for another second point', async () => {
  const f = await setup()
  f.drawing.start()
  f.click({ longitude: 0, latitude: 0 })
  for (const point of [{ longitude: .000001, latitude: 0 }, { longitude: 180, latitude: 0 }]) {
    f.click(point)
    assert.equal(f.drawing.active, true)
    assert.equal(f.selected.length, 0)
    assert.ok(f.hints.at(-1).length > 0)
  }
  f.click({ longitude: 1, latitude: 0 })
  assert.equal(f.selected.length, 1)
  f.drawing.destroy()
})
test('Escape, restart and destruction clean transient resources without committing a path', async () => {
  const f = await setup(false)
  f.drawing.start()
  f.click({ longitude: 10, latitude: 20 })
  f.move({ longitude: 15, latitude: 20 })
  const preview = f.primitives.get(0)
  const escape = new Event('keydown'); Object.defineProperty(escape, 'key', { value: 'Escape' })
  f.keyboard.dispatchEvent(escape)
  assert.equal(f.drawing.active, false)
  assert.equal(f.viewer.scene.screenSpaceCameraController.enableInputs, false)
  assert.equal(f.viewer.canvas.style.cursor, 'grab')
  assert.equal(preview.isDestroyed(), true)
  assert.equal(f.selected.length, 0)
  f.drawing.start()
  f.click({ longitude: 10, latitude: 20 })
  f.drawing.start()
  f.click({ longitude: 15, latitude: 20 })
  assert.equal(f.selected.length, 0, 'restart resets the first point')
  f.move({ longitude: 16, latitude: 21 })
  f.drawing.destroy()
  assert.equal(f.handler.dead, true)
  assert.equal(f.primitives.length, 0)
  assert.equal(f.drawing.active, false)
  const callbacks = f.active.length
  f.keyboard.dispatchEvent(escape)
  assert.equal(f.active.length, callbacks)
  assert.doesNotThrow(() => f.drawing.destroy())
})
