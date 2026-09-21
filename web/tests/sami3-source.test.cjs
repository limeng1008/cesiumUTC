const ts = require('typescript')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const assert = require('node:assert/strict')
const { test } = require('node:test')
function load(file, imports = {}) {
  const filename = path.resolve(__dirname, file)
  const module = new Module(filename, moduleParent)
  module.paths = Module._nodeModulePaths(path.dirname(filename))
  const originalRequire = module.require.bind(module)
  module.require = (id) => {
    if (Object.hasOwn(imports, id)) return imports[id]
    if (id.startsWith('.')) {
      const candidate = path.resolve(path.dirname(filename), id) + '.ts'
      if (fs.existsSync(candidate)) return load(candidate, imports)
    }
    return originalRequire(id)
  }
  const source = fs
    .readFileSync(filename, 'utf8')
    .replaceAll('import.meta.env.VITE_BASE_API', "'/api/v1'")
  module._compile(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText,
    filename
  )
  return module.exports
}
const moduleParent = module
const catalog = {
  defaultSource: 'sami3',
  sources: [
    { id: 'mock', name: 'Deterministic Mock', available: true },
    { id: 'sami3', name: 'SAMI3 模型数据', available: true },
  ],
}
test('import selection pins metadata and binary to the same task', async () => {
  const urls = []
  const api = load('../src/services/ionosphere/ionosphereApi.ts', {
    '../../utils/auth/token': { getToken: () => 'token' },
    '../../models/ionosphere/validation': {
      validateMetadata: (m) => m,
      decodeVolume: (metadata, values) => ({ metadata, values }),
    },
  })
  const original = global.fetch
  global.fetch = async (url) => {
    urls.push(new URL(url, 'http://local'))
    return {
      ok: true,
      json: async () => ({ code: 200, data: { id: 'content-sha', source: 'sami3-model' } }),
      headers: new Map([
        ['content-type', 'application/octet-stream'],
        ['x-volume-id', 'content-sha'],
      ]),
      arrayBuffer: async () => new ArrayBuffer(4),
    }
  }
  try {
    await api.fetchVolume('standard', new AbortController().signal, 'sami3', 'import-123')
    assert.equal(urls[0].searchParams.get('importId'), 'import-123')
    assert.equal(urls[1].searchParams.get('importId'), 'import-123')
    assert.equal(urls[1].searchParams.get('volumeId'), 'content-sha')
  } finally {
    global.fetch = original
  }
})
test('controller restores and reloads selected import without choosing global snapshot', async () => {
  const requested = []
  const { IonosphereVolumeController } = load(
    '../src/cesium/ionosphere/IonosphereVolumeController.ts',
    {
      '../../services/ionosphere/ionosphereApi': {
        fetchSources: async () => {
          throw Error('legacy source unavailable')
        },
        fetchVolume: async (...args) => {
          requested.push(args)
          return {}
        },
      },
    }
  )
  const controller = new IonosphereVolumeController(
    { clear() {}, load() {}, destroy() {} },
    { data() {}, error() {} }
  )
  await controller.initialize('standard', 'sami3', 'import-123')
  assert.equal(requested[0][3], 'import-123')
  controller.destroy()
})
test('store handles route import changes and clears selection without falling back', () => {
  const { createPinia, setActivePinia } = require('pinia')
  setActivePinia(createPinia())
  const calls = []
  class Controller {
    initialize(...args) {
      calls.push(['initialize', ...args])
    }
    load(...args) {
      calls.push(['load', ...args])
    }
    clear() {
      calls.push(['clear'])
    }
    destroy() {}
    configure() {}
  }
  const { useVolumeStore } = load('../src/store/ionosphere/volume.ts', {
    '../../cesium/ionosphere/IonosphereVolumeController': {
      IonosphereVolumeController: Controller,
    },
  })
  const store = useVolumeStore()
  assert.equal(typeof store.selectImport, 'function')
  store.selectImport('task-a')
  store.attach({})
  assert.equal(store.source, 'sami3')
  assert.deepEqual(calls[0], ['initialize', 'standard', 'sami3', 'task-a'])
  store.selectImport('task-b')
  assert.deepEqual(calls[1], ['load', 'standard', 'sami3', 'task-b'])
  store.selectImport(undefined)
  assert.equal(store.importId, undefined)
  assert.deepEqual(calls[2], ['clear'])
  store.detach()
})
test('binary transport pins selected source and immutable metadata volume ID', async () => {
  const calls = []
  const metadata = { id: 'sami3-v1', source: 'sami3-model' }
  const api = load('../src/services/ionosphere/ionosphereApi.ts', {
    '../../utils/auth/token': { getToken: () => 'test-token' },
    '../../models/ionosphere/validation': {
      validateMetadata: (m) => m,
      decodeVolume: (m, b) => ({ metadata: m, values: b }),
    },
  })
  const original = global.fetch
  global.fetch = async (url, options) => {
    calls.push({ url, options })
    return {
      ok: true,
      json: async () => ({ code: 200, data: metadata }),
      headers: new Map([
        ['content-type', 'application/octet-stream'],
        ['x-volume-id', metadata.id],
      ]),
      arrayBuffer: async () => new ArrayBuffer(4),
    }
  }
  try {
    const signal = new AbortController().signal
    await api.fetchVolume('fine', signal, 'sami3')
    assert.equal(new URL(calls[0].url, 'http://local').searchParams.get('source'), 'sami3')
    assert.equal(new URL(calls[1].url, 'http://local').searchParams.get('source'), 'sami3')
    assert.equal(new URL(calls[1].url, 'http://local').searchParams.get('volumeId'), 'sami3-v1')
    assert.equal(calls[1].options.signal, signal)
    assert.equal(calls[0].options.headers.token, 'test-token')
  } finally {
    global.fetch = original
  }
})
test('source catalog uses authenticated request and rejects malformed responses', async () => {
  const api = load('../src/services/ionosphere/ionosphereApi.ts', {
    '../../utils/auth/token': { getToken: () => 'test-token' },
    '../../models/ionosphere/validation': {},
  })
  assert.equal(typeof api.fetchSources, 'function')
  const original = global.fetch
  let data = catalog
  global.fetch = async (url, options) => {
    assert.equal(url, '/api/v1/ionosphere/sources')
    assert.equal(options.headers.token, 'test-token')
    return { ok: true, json: async () => ({ code: 200, data }) }
  }
  try {
    assert.deepEqual(await api.fetchSources(new AbortController().signal), catalog)
    data = { defaultSource: 'unknown', sources: [] }
    await assert.rejects(api.fetchSources(new AbortController().signal))
  } finally {
    global.fetch = original
  }
})
test('missing SAMI3 errors retain the backend import instructions', async () => {
  const api = load('../src/services/ionosphere/ionosphereApi.ts', {
    '../../utils/auth/token': { getToken: () => 'test-token' },
    '../../models/ionosphere/validation': {},
  })
  const original = global.fetch
  global.fetch = async () => ({
    ok: false,
    status: 503,
    json: async () => ({ detail: 'SAMI3 快照或指定版本尚未导入，请运行导入脚本' }),
  })
  try {
    await assert.rejects(
      api.fetchVolume('standard', new AbortController().signal, 'sami3'),
      /SAMI3 快照或指定版本尚未导入，请运行导入脚本/
    )
  } finally {
    global.fetch = original
  }
})
test('transport rejects metadata belonging to a different source before fetching binary', async () => {
  const api = load('../src/services/ionosphere/ionosphereApi.ts', {
    '../../utils/auth/token': { getToken: () => 'test-token' },
    '../../models/ionosphere/validation': {
      validateMetadata: (m) => m,
      decodeVolume: (metadata, values) => ({ metadata, values }),
    },
  })
  const original = global.fetch
  let calls = 0,
    metadataSource = 'deterministic-mock'
  global.fetch = async () => {
    calls++
    return {
      ok: true,
      json: async () => ({ code: 200, data: { id: 'wrong-source', source: metadataSource } }),
      headers: new Map([
        ['content-type', 'application/octet-stream'],
        ['x-volume-id', 'wrong-source'],
      ]),
      arrayBuffer: async () => new ArrayBuffer(4),
    }
  }
  try {
    await assert.rejects(
      api.fetchVolume('standard', new AbortController().signal, 'sami3'),
      /数据源不一致/
    )
    assert.equal(calls, 1)
    metadataSource = 'sami3-model'
    await assert.rejects(
      api.fetchVolume('standard', new AbortController().signal, 'mock'),
      /数据源不一致/
    )
    assert.equal(calls, 2)
  } finally {
    global.fetch = original
  }
})
test('catalog cannot trigger loading after controller teardown', async () => {
  let resolveCatalog, signal
  const calls = []
  const { IonosphereVolumeController } = load(
    '../src/cesium/ionosphere/IonosphereVolumeController.ts',
    {
      '../../services/ionosphere/ionosphereApi': {
        fetchSources: (s) => {
          signal = s
          return new Promise((resolve) => {
            resolveCatalog = resolve
          })
        },
        fetchVolume: async () => {
          calls.push('fetch')
          return {}
        },
      },
    }
  )
  const controller = new IonosphereVolumeController(
    {
      clear() {},
      load() {
        calls.push('render')
      },
      destroy() {},
    },
    {
      data() {
        calls.push('data')
      },
      error() {
        calls.push('error')
      },
      catalog() {
        calls.push('catalog')
      },
    }
  )
  assert.equal(typeof controller.initialize, 'function')
  const pending = controller.initialize('standard', 'sami3')
  controller.destroy()
  resolveCatalog(catalog)
  await pending
  assert.ok(signal.aborted)
  assert.deepEqual(calls, [])
})
test('explicit source persists through initialization and failed loads never fallback', async () => {
  const requested = []
  const errors = []
  const { IonosphereVolumeController } = load(
    '../src/cesium/ionosphere/IonosphereVolumeController.ts',
    {
      '../../services/ionosphere/ionosphereApi': {
        fetchSources: async () => catalog,
        fetchVolume: async (_r, _s, source) => {
          requested.push(source)
          throw Error('source missing')
        },
      },
    }
  )
  const controller = new IonosphereVolumeController(
    { clear() {}, load() {}, destroy() {} },
    { data() {}, error: (e) => errors.push(e), catalog() {} }
  )
  assert.equal(typeof controller.initialize, 'function')
  await controller.initialize('standard', 'mock')
  await controller.load('standard', 'sami3')
  assert.deepEqual(requested, ['mock', 'sami3'])
  assert.deepEqual(errors, ['source missing', 'source missing'])
})
test('replacing data clears old scene immediately and ignores superseded completion', async () => {
  const pending = []
  const loaded = []
  let clears = 0
  const { IonosphereVolumeController } = load(
    '../src/cesium/ionosphere/IonosphereVolumeController.ts',
    {
      '../../services/ionosphere/ionosphereApi': {
        fetchVolume: (_r, signal, source) =>
          new Promise((resolve) => pending.push({ signal, source, resolve })),
      },
    }
  )
  const controller = new IonosphereVolumeController(
    {
      clear() {
        clears++
      },
      load(v) {
        loaded.push(v)
      },
      destroy() {},
    },
    { data() {}, error() {} }
  )
  const first = controller.load('standard', 'mock')
  const second = controller.load('standard', 'sami3')
  assert.equal(clears, 2)
  assert.ok(pending[0].signal.aborted)
  pending[1].resolve({ source: 'sami3' })
  await second
  pending[0].resolve({ source: 'mock' })
  await first
  assert.deepEqual(loaded, [{ source: 'sami3' }])
})
test('store clears private selection on route leave and reloads only an explicit import', () => {
  const { createPinia, setActivePinia } = require('pinia')
  setActivePinia(createPinia())
  const controllers = []
  class Controller {
    constructor(_r, events) {
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
    configure() {}
    destroy() {}
    cancelRegionSelection() {}
  }
  const { useVolumeStore } = load('../src/store/ionosphere/volume.ts', {
    '../../cesium/ionosphere/IonosphereVolumeController': {
      IonosphereVolumeController: Controller,
    },
  })
  const store = useVolumeStore()
  store.attach({})
  assert.deepEqual(controllers[0].calls, [['clear']])
  store.selectImport('first')
  const metadata = {
    source: 'sami3-model',
    altitude: { min: 90, max: 1000 },
    minValue: 1,
    maxValue: 10,
  }
  controllers[0].events.data({ metadata }, 12)
  store.rendererEvents.ready()
  store.selectImport('second')
  assert.equal(store.metadata, null)
  store.clearSelection()
  store.selectImport('second')
  assert.deepEqual(controllers[0].calls.at(-1), ['load', 'standard', 'sami3', 'second'])
  store.detach()
  store.attach({})
  assert.equal(store.importId, undefined)
  assert.deepEqual(controllers[1].calls, [['clear']])
  store.detach()
})
test('controller clear cancels an outstanding load and cannot republish stale data', async () => {
  let resolve, signal
  const loaded = []
  const { IonosphereVolumeController } = load(
    '../src/cesium/ionosphere/IonosphereVolumeController.ts',
    {
      '../../services/ionosphere/ionosphereApi': {
        fetchVolume: (_r, s) => {
          signal = s
          return new Promise((r) => (resolve = r))
        },
      },
    }
  )
  const controller = new IonosphereVolumeController(
    {
      clear() {},
      load(v) {
        loaded.push(v)
      },
      destroy() {},
    },
    {
      data(v) {
        loaded.push(v)
      },
      error() {},
    }
  )
  const pending = controller.load('standard', 'sami3', 'id')
  controller.clear()
  assert.ok(signal.aborted)
  resolve({})
  await pending
  assert.deepEqual(loaded, [])
  controller.destroy()
})
