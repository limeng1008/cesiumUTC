const ts = require('typescript')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const assert = require('node:assert/strict')
const { test } = require('node:test')
function load(file, imports = {}) {
  const filename = path.resolve(__dirname, file)
  const loaded = new Module(filename, module)
  loaded.paths = Module._nodeModulePaths(path.dirname(filename))
  const original = loaded.require.bind(loaded)
  loaded.require = id => {
    if (Object.hasOwn(imports, id)) return imports[id]
    if (id.startsWith('.')) {
      const candidate = path.resolve(path.dirname(filename), id) + '.ts'
      if (fs.existsSync(candidate)) return load(candidate, imports)
    }
    return original(id)
  }
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env.VITE_BASE_API', "'/api/v1'"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, filename)
  return loaded.exports
}
const apiPath = '../src/services/ionosphere/datasetApi.ts'
const auth = { '../../utils/auth/token': { getToken: () => 'secret-token' } }
const dataset = { id: 'dataset-a', name: 'content', originalName: 'content', byteSize: 128, status: 'preview', imports: [], preview: { times: [{ index: 0, timestamp: '2020-01-01T00:00:00Z' }, { index: 1, timestamp: '2020-01-01T01:00:00Z' }] } }
test('dataset management API exists with raw upload and authenticated records', () => {
  assert.ok(fs.existsSync(path.resolve(__dirname, apiPath)), 'dataset API must exist')
})
test('raw upload accepts extensionless SAMI3 file, reports transfer progress and blocks oversize before transport', async () => {
  assert.ok(fs.existsSync(path.resolve(__dirname, apiPath)))
  const api = load(apiPath, auth)
  const original = global.XMLHttpRequest
  const calls = [], progress = []
  class XHR {
    constructor() { this.upload = {}; this.headers = {}; this.status = 200; this.responseText = JSON.stringify({ code: 200, data: dataset }) }
    open(method, url) { this.method = method; this.url = url }
    setRequestHeader(key, value) { this.headers[key] = value }
    send(body) { calls.push(this); this.body = body; this.upload.onprogress({ lengthComputable: true, loaded: 32, total: 128 }); this.onload() }
  }
  global.XMLHttpRequest = XHR
  try {
    const file = { name: 'content', size: 128 }
    assert.deepEqual(await api.uploadDataset(file, value => progress.push(value)), dataset)
    assert.equal(calls[0].body, file)
    assert.equal(calls[0].headers['Content-Type'], 'application/octet-stream')
    assert.equal(calls[0].headers.token, 'secret-token')
    assert.equal(new URL(calls[0].url, 'http://local').searchParams.get('filename'), 'content')
    assert.ok(progress.includes(25))
    await assert.rejects(api.uploadDataset({ name: 'huge.nc', size: 1024 ** 3 + 1 }), /1 GiB/)
    assert.equal(calls.length, 1)
  } finally { global.XMLHttpRequest = original }
})
test('list, detail, inspect retry and import retry follow API contract and preserve errors', async () => {
  assert.ok(fs.existsSync(path.resolve(__dirname, apiPath)))
  const api = load(apiPath, auth), calls = [], original = global.fetch
  global.fetch = async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ code: 200, data: dataset }) } }
  try {
    await api.fetchDatasets(2, 20)
    await api.fetchDataset('dataset-a')
    await api.inspectDataset('dataset-a')
    await api.importDataset('dataset-a', 1)
    assert.equal(calls[0].url, '/api/v1/ionosphere/datasets?page=2&pageSize=20')
    assert.equal(calls[1].url, '/api/v1/ionosphere/datasets/dataset-a')
    assert.equal(calls[2].url, '/api/v1/ionosphere/datasets/dataset-a/inspect')
    assert.equal(calls[2].options.method, 'POST')
    assert.equal(calls[3].options.body, JSON.stringify({ timeIndex: 1 }))
    assert.ok(calls.every(call => call.options.headers.token === 'secret-token'))
    global.fetch = async () => ({ ok: false, status: 403, json: async () => ({ detail: '无权访问数据集' }) })
    await assert.rejects(api.fetchDataset('private'), /无权访问数据集/)
  } finally { global.fetch = original }
})
test('dataset state selects a preview time, tracks imported task, and ignores stale detail completions', async () => {
  const storePath = '../src/store/ionosphere/datasets.ts'
  assert.ok(fs.existsSync(path.resolve(__dirname, storePath)), 'dataset store must exist')
  const { createPinia, setActivePinia } = require('pinia'); setActivePinia(createPinia())
  const pending = [], imports = []
  const task = { id: 'task-a', datasetId: dataset.id, timeIndex: 1, status: 'queued', progress: 0 }
  const { useDatasetStore } = load(storePath, { '../../services/ionosphere/datasetApi': {
    fetchDataset: id => new Promise(resolve => pending.push({ id, resolve })),
    importDataset: async (...args) => { imports.push(args); return task },
  } })
  const store = useDatasetStore()
  const first = store.selectDataset('old'), second = store.selectDataset(dataset.id)
  pending[1].resolve(dataset); await second
  pending[0].resolve({ ...dataset, id: 'old' }); await first
  assert.equal(store.selected.id, dataset.id)
  assert.equal(store.timeIndex, 0)
  store.timeIndex = 1
  await store.createImport()
  assert.equal(imports[0][0], dataset.id)
  assert.equal(imports[0][1], 1)
  assert.equal(store.selected.imports[0].id, task.id)
  assert.equal(store.hasActiveWork, true)
  store.dispose()
})
test('management page compiles with upload, time selection and ready-only 3D navigation', async () => {
  const filename = path.resolve(__dirname, '../src/views/data-management/index.vue')
  assert.ok(fs.existsSync(filename), 'management page must exist')
  const { parse, compileScript, compileTemplate } = require('vue/compiler-sfc')
  const { descriptor, errors } = parse(fs.readFileSync(filename, 'utf8'), { filename })
  assert.deepEqual(errors, [])
  assert.deepEqual(compileTemplate({ id: 'datasets-ui', source: descriptor.template.content, filename }).errors, [])
  const script = compileScript(descriptor, { id: 'datasets-ui' })
  const calls = [], store = { uploading: false, upload: async file => calls.push(file), page: 1, refresh: async () => {} }
  const loaded = new Module(filename, module)
  loaded.require = id => {
    if (id === 'vue') return { ...require('vue'), onMounted() {}, onBeforeUnmount() {} }
    if (id === 'vue-router') return { useRouter: () => ({ push: target => calls.push(target) }) }
    if (id === '@/store/ionosphere/datasets') return { useDatasetStore: () => store }
    if (id === '@/services/ionosphere/datasetApi') return load(apiPath, auth)
    return {}
  }
  loaded._compile(ts.transpileModule(script.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename)
  const page = loaded.exports.default.setup({}, { expose() {} })
  page.open3D({ id: 'failed', status: 'failed' })
  assert.deepEqual(calls, [])
  page.open3D({ id: 'task-a', status: 'ready' })
  assert.deepEqual(calls.pop(), { path: '/ionosphere', query: { importId: 'task-a' } })
  const file = new File(['SAMI3 fixture'], 'content')
  page.chooseFile({ target: { files: [file] } })
  await page.sendUpload()
  assert.equal(calls[0], file)
  assert.match(page.taskStage({ status: 'processing', progress: 20 }), /转换/)
  assert.match(page.taskStage({ status: 'processing', progress: 90 }), /写入/)
  assert.doesNotMatch(page.taskStage({ status: 'processing', progress: 20 }), /%/)
})
function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
function datasetStore(api) {
  const { createPinia, setActivePinia } = require('pinia')
  setActivePinia(createPinia())
  return load('../src/store/ionosphere/datasets.ts', { '../../services/ionosphere/datasetApi': api }).useDatasetStore()
}
test('old detail polling cannot remove a newly queued import and stop further polling', async () => {
  const detail = deferred()
  const task = { id: 'new-task', datasetId: dataset.id, timeIndex: 0, status: 'queued', progress: 0 }
  const store = datasetStore({
    fetchDatasets: async () => ({ items: [dataset], total: 1 }),
    fetchDataset: () => detail.promise,
    importDataset: async () => task,
  })
  store.selected = dataset
  store.items = [dataset]
  const poll = store.refresh(false)
  await Promise.resolve()
  await store.createImport()
  detail.resolve(dataset)
  await poll
  assert.equal(store.selected.imports[0]?.id, task.id)
  assert.equal(store.items[0].imports[0]?.id, task.id)
  assert.equal(store.hasActiveWork, true)
  assert.equal(store.loading, false)
  store.dispose()
})
test('old list polling cannot overwrite a just queued import after selection changes', async () => {
  const list = deferred(), posted = deferred()
  const other = { ...dataset, id: 'other' }
  const task = { id: 'new-task', datasetId: dataset.id, timeIndex: 0, status: 'queued', progress: 0 }
  const store = datasetStore({
    fetchDatasets: () => list.promise,
    fetchDataset: async () => other,
    importDataset: () => posted.promise,
  })
  store.selected = dataset
  store.items = [dataset, other]
  const creating = store.createImport()
  const poll = store.refresh(false)
  await store.selectDataset(other.id)
  posted.resolve(task)
  await creating
  list.resolve({ items: [dataset, other], total: 2 })
  await poll
  assert.equal(store.selected.id, other.id)
  assert.equal(store.items[0].imports[0]?.id, task.id)
  assert.equal(store.hasActiveWork, true)
  assert.equal(store.loading, false)
  store.dispose()
})
test('inspect retry invalidates a previous failed detail snapshot', async () => {
  const detail = deferred()
  const failed = { ...dataset, status: 'failed' }
  const inspecting = { ...dataset, status: 'inspecting', preview: null }
  const store = datasetStore({ fetchDatasets: async () => ({ items: [failed], total: 1 }), fetchDataset: () => detail.promise, inspectDataset: async () => inspecting })
  store.selected = failed
  const poll = store.refresh(false)
  await Promise.resolve()
  await store.retryInspect()
  detail.resolve(failed)
  await poll
  assert.equal(store.selected.status, 'inspecting')
  assert.equal(store.hasActiveWork, true)
  store.dispose()
})
test('completed upload clears a superseded detail loading indicator', async () => {
  const oldSelection = deferred()
  const uploaded = { ...dataset, id: 'uploaded' }
  const store = datasetStore({
    fetchDataset: id => id === 'old' ? oldSelection.promise : Promise.resolve(uploaded),
    fetchDatasets: async () => ({ items: [uploaded], total: 1 }),
    uploadDataset: async () => uploaded,
  })
  const selection = store.selectDataset('old')
  await store.upload(new File(['netcdf'], 'content'))
  oldSelection.resolve({ ...dataset, id: 'old' })
  await selection
  assert.equal(store.selected.id, uploaded.id)
  assert.equal(store.detailLoading, false)
  store.dispose()
})
test('upload completion preserves a newer user selection including its pending detail', async () => {
  const upload = deferred(), detail = deferred()
  const other = { ...dataset, id: 'other' }, uploaded = { ...dataset, id: 'uploaded' }
  const store = datasetStore({
    fetchDataset: () => detail.promise,
    fetchDatasets: async () => ({ items: [uploaded, other], total: 2 }),
    uploadDataset: () => upload.promise,
  })
  const uploading = store.upload(new File(['netcdf'], 'content'))
  const selecting = store.selectDataset(other.id)
  upload.resolve(uploaded)
  await Promise.resolve(); await Promise.resolve()
  detail.resolve(other)
  await Promise.all([uploading, selecting])
  assert.equal(store.selected.id, other.id)
  assert.equal(store.detailLoading, false)
  store.dispose()
})
test('leaving management clears cached private records and old upload completion cannot reset a new upload', async () => {
  const oldUpload = deferred(), newUpload = deferred()
  let uploads = 0
  const store = datasetStore({
    uploadDataset: () => (++uploads === 1 ? oldUpload.promise : newUpload.promise),
    fetchDatasets: async () => ({ items: [], total: 0 }),
    fetchDataset: async () => dataset,
  })
  store.items = [dataset]
  store.selected = dataset
  store.total = 1
  store.timeIndex = 1
  const oldPending = store.upload(new File(['old'], 'content'))
  store.dispose()
  assert.deepEqual(store.items, [])
  assert.equal(store.selected, null)
  assert.equal(store.total, 0)
  assert.equal(store.timeIndex, 0)
  assert.equal(store.uploading, false)
  store.activate()
  const newPending = store.upload(new File(['new'], 'content'))
  oldUpload.resolve(dataset)
  await oldPending
  assert.equal(store.uploading, true)
  assert.equal(store.selected, null)
  newUpload.resolve(dataset)
  await newPending
  assert.equal(store.uploading, false)
  store.dispose()
})
