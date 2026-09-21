const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'),
  path = require('node:path'),
  Module = require('node:module'),
  ts = require('typescript')
const { createPinia, setActivePinia } = require('pinia')
const file = path.resolve(__dirname, '../src/store/ionosphere/managedVolumes.ts')
const record = (id, tasks) => ({
  id,
  name: id,
  status: 'preview',
  imports: tasks.map(([id, timeIndex, status]) => ({
    id,
    timeIndex,
    status,
    timestamp: `2019-04-25T${String(timeIndex).padStart(2, '0')}:00:00Z`,
  })),
})
const items = [
  record('a', [['failed', 3, 'failed']]),
  record('b', [
    ['b0', 0, 'ready'],
    ['b2', 2, 'ready'],
    ['pending', 4, 'processing'],
  ]),
]
function setup(fetchDatasets = async () => ({ items, total: 2 })) {
  setActivePinia(createPinia())
  assert.ok(fs.existsSync(file), 'managed data catalog store must exist')
  const m = new Module(file, module)
  m.paths = Module._nodeModulePaths(path.dirname(file))
  const original = m.require.bind(m)
  m.require = (id) => {
    if (id.endsWith('/datasetApi')) return { fetchDatasets, fetchDataset:async id=>items.find(d=>d.id===id) }
    if (id.endsWith('/parameters')) {
      const filename=path.resolve(path.dirname(file),id)+'.ts', helper=new Module(filename,module)
      helper._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,filename)
      return helper.exports
    }
    return original(id)
  }
  m._compile(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText,
    file
  )
  return m.exports.useManagedVolumesStore()
}
test('managed source defaults to latest ready task and preserves precise requested task', async () => {
  const s = setup()
  await s.refresh()
  assert.equal(s.datasetId, 'b')
  assert.equal(s.importId, 'b2')
  assert.deepEqual(
    s.readyImports.map((i) => i.id),
    ['b0', 'b2']
  )
  await s.refresh('b0')
  assert.equal(s.importId, 'b0')
  s.selectDataset('a')
  assert.equal(s.importId, undefined)
  assert.deepEqual(s.readyImports, [])
  s.selectDataset('b')
  s.selectImport('pending')
  assert.equal(s.importId, 'b2')
  s.dispose()
  assert.deepEqual(s.items, [])
})
test('unknown task and empty catalog never fall back to another task', async () => {
  const s = setup()
  await s.refresh('unknown')
  assert.equal(s.importId, undefined)
  assert.ok(s.error)
  s.dispose()
  const empty = setup(async () => ({ items: [], total: 0 }))
  await empty.refresh()
  assert.equal(empty.importId, undefined)
  assert.equal(empty.datasetId, '')
  empty.dispose()
})
test('catalog pagination and stale/disposed requests are isolated', async () => {
  const s = setup(async (page) => ({ items: page === 1 ? [items[0]] : [items[1]], total: 2 }))
  await s.refresh()
  assert.equal(s.items.length, 2)
  s.dispose()
  const pending = []
  const delayed = setup(
    (page, size, signal) => new Promise((resolve) => pending.push({ resolve, signal }))
  )
  const old = delayed.refresh(),
    newer = delayed.refresh()
  assert.ok(pending[0].signal.aborted)
  pending[1].resolve({ items: [], total: 0 })
  await newer
  pending[0].resolve({ items, total: 2 })
  await old
  assert.deepEqual(delayed.items, [])
  const last = delayed.refresh()
  delayed.dispose()
  pending[2].resolve({ items, total: 2 })
  await last
  assert.deepEqual(delayed.items, [])
})
test('production volume UI has no demo source or Shandong entry and uses managed selectors', () => {
  for (const name of [
    'views/ionosphere/volume/index.vue',
    'components/ionosphere/VolumeControlPanel.vue',
  ]) {
    const source = fs.readFileSync(path.resolve(__dirname, '../src', name), 'utf8')
    assert.doesNotMatch(source, /山东|shandong|isShandong|store\.sources|selectSource/)
  }
  assert.match(
    fs.readFileSync(
      path.resolve(__dirname, '../src/components/ionosphere/VolumeControlPanel.vue'),
      'utf8'
    ),
    /ManagedVolumeSource/
  )
})
test('query-only import changes retain the Cesium view instance', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/layout/components/AppMain.vue'), 'utf8')
  assert.match(source, /route\.path === '\/ionosphere'\s*\? route\.path\s*: route\.fullPath/)
  assert.match(source, /route\.path === '\/analysis'\s*\? route\.path/)
})
for (const nextId of ['b2', undefined]) test(`URL changes during catalog loading preserve ${nextId || 'empty selection'}`, async () => {
  const vue = require('vue'), {parse,compileScript}=require('vue/compiler-sfc')
  const pending=[], catalog=setup((page,size,signal)=>new Promise(resolve=>pending.push({resolve,signal})))
  const route=vue.reactive({query:{importId:'b0'}}), published=[]
  const volume={selectImport(id){published.push(id)},clearSelection(){}}
  const hooks=[], filename=path.resolve(__dirname,'../src/components/ionosphere/ManagedVolumeSource.vue')
  const {descriptor}=parse(fs.readFileSync(filename,'utf8'),{filename})
  const content=compileScript(descriptor,{id:'managed-source'}).content
  const m=new Module(filename,module)
  m.require=id=>id==='vue'?{...vue,onMounted:fn=>hooks.push(fn),onBeforeUnmount(){}}:id==='vue-router'?{useRoute:()=>route,useRouter:()=>({replace:async({query})=>{route.query=query}})}:id.endsWith('/managedVolumes')?{useManagedVolumesStore:()=>catalog}:id.endsWith('/volume')?{useVolumeStore:()=>volume}:{}
  m._compile(ts.transpileModule(content,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,filename)
  const scope=vue.effectScope();scope.run(()=>m.exports.default.setup({}, {expose(){}}))
  const first=hooks[0]()
  route.query=nextId ? {importId:nextId} : {};await vue.nextTick()
  assert.equal(pending.length,2)
  assert.ok(pending[0].signal.aborted)
  pending[1].resolve({items,total:2});await new Promise(r=>setTimeout(r,0))
  pending[0].resolve({items,total:2});await first
  assert.equal(route.query.importId,nextId);assert.equal(catalog.importId,nextId)
  assert.deepEqual(published,[nextId])
  scope.stop();catalog.dispose()
})
