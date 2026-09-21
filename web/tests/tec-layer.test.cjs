const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  ts = require('typescript')
require.extensions['.ts'] = (m, f) =>
  m._compile(
    ts.transpileModule(fs.readFileSync(f, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText,
    f
  )
test('TEC layer replaces one owned image, updates visibility and ignores stale asynchronous providers', async () => {
  const { TecLayer } = require('../src/cesium/ionosphere/renderer/TecLayer.ts')
  const jobs = [],
    layers = []
  const C = {
    Rectangle: { fromDegrees: (...v) => v },
    SingleTileImageryProvider: { fromUrl: () => new Promise((resolve) => jobs.push(resolve)) },
  }
  const viewer = {
    isDestroyed: () => false,
    scene: { requestRender() {} },
    imageryLayers: {
      addImageryProvider: (p) => {
        const l = { p }
        layers.push(l)
        return l
      },
      remove: (l) => {
        layers.splice(layers.indexOf(l), 1)
      },
    },
  }
  const old = global.document
  global.document = {
    createElement: () => ({
      getContext: () => ({
        createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        putImageData() {},
      }),
      toDataURL: () => 'data:image/png;base64,test',
    }),
  }
  try {
    const layer = new TecLayer(C, viewer),
      axis = { min: -90, max: 90, count: 2, step: 90 },
      grid = { longitude: axis, latitude: axis, values: [1, 2, 3, 4], range: [1, 4] }
    const a = layer.update(grid)
    const b = layer.update({ ...grid })
    jobs[1]({ id: 2 })
    await b
    jobs[0]({ id: 1 })
    await a
    assert.equal(layers.length, 1)
    assert.equal(layers[0].p.id, 2)
    layer.setAppearance(false, 0.3)
    assert.equal(layers[0].show, false)
    assert.equal(layers[0].alpha, 0.3)
    const c = layer.update(grid)
    layer.destroy()
    jobs[2]({ id: 3 })
    await c
    assert.equal(layers.length, 0)
  } finally {
    global.document = old
  }
})
