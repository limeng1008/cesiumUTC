const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript')
function load(file, mocks = {}) {
  const filename = path.resolve(__dirname, file), m = new Module(filename, module)
  m.paths = Module._nodeModulePaths(path.dirname(filename))
  const original = m.require.bind(m)
  m.require = id => {
    if (id in mocks) return mocks[id]
    const resolved = path.resolve(path.dirname(filename), id) + '.ts'
    return id.startsWith('.') && fs.existsSync(resolved) ? load(resolved, mocks) : original(id)
  }
  m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env.VITE_BASE_API', "'/api/v1'"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename)
  return m.exports
}
const axis = (min, max) => ({ min, max, count: 2, step: (max-min)/2 })
const metadata = (parameter='Ne', unit='m^-3', minValue=1) => ({ parameter, unit, parameterName: parameter, id:'test', altitudeUnit:'km', sampling:'cell-center', order:'zyx', dtype:'float32', byteOrder:'little', longitude:axis(-180,180), latitude:axis(-90,90), altitude:axis(90,1000), minValue, maxValue:2000, byteLength:32 })
test('physical metadata supports Kelvin fields and zero density but not zero temperature or unit mismatch', () => {
  const { validateMetadata } = load('../src/models/ionosphere/validation.ts')
  assert.equal(validateMetadata(metadata('Te','K')).parameter,'Te')
  assert.equal(validateMetadata(metadata('Ni_O+','m^-3',0)).minValue,0)
  assert.throws(()=>validateMetadata(metadata('Te','m^-3')))
  assert.throws(()=>validateMetadata(metadata('Te','K',0)))
  assert.throws(()=>validateMetadata(metadata('unknown','K')))
})
test('temperature settings default linear, while electron density stays logarithmic', () => {
  const { defaultSettings } = load('../src/models/ionosphere/IonosphereVolume.ts')
  assert.equal(defaultSettings(metadata('Te','K')).normalization,'linear')
  assert.equal(defaultSettings(metadata()).normalization,'log')
})
test('explicit parameter is carried by single, batch and cancellation API requests', async () => {
  const api = load('../src/services/ionosphere/datasetApi.ts', {'../../utils/auth/token':{ getToken:()=>'' }}), calls=[]
  const old=global.fetch
  global.fetch=async(url,options)=>{calls.push(JSON.parse(options.body));return {ok:true,json:async()=>({code:200,data:{}})}}
  try {
    await api.importDataset('d',0,undefined,'Te')
    await api.importDatasetBatch('d',[0,1],undefined,'Ti')
    await api.cancelDatasetImports('d',[1],undefined,'Te')
    assert.deepEqual(calls.map(c=>c.parameter),['Te','Ti','Te'])
  } finally {global.fetch=old}
})
test('Ne temporal directory ignores newer temperature imports at the same timestamp', () => {
  const {timeSlots}=load('../src/utils/ionosphere/temporal.ts'), stamp='2020-01-01T00:00:00Z'
  const d={id:'d',preview:{times:[{index:0,timestamp:stamp}]},imports:[{id:'ne',datasetId:'d',timeIndex:0,timestamp:stamp,status:'ready'}, {id:'te',datasetId:'d',timeIndex:0,timestamp:stamp,status:'ready',parameter:'Te',createdAt:'2026-01-01'}]}
  assert.equal(timeSlots(d,Date.parse(stamp),Date.parse(stamp))[0].task.id,'ne')
})
test('volume store resets scientific ranges on physical parameter change', () => {
  const {createPinia,setActivePinia}=require('pinia');setActivePinia(createPinia())
  let events
  class Controller {constructor(r,e){events=e}clear(){}destroy(){}configure(){}load(){}cancelRegionSelection(){}cancelSectionSelection(){}}
  const {useVolumeStore}=load('../src/store/ionosphere/volume.ts',{'../../cesium/ionosphere/IonosphereVolumeController':{IonosphereVolumeController:Controller}})
  const s=useVolumeStore();s.attach({})
  events.data({metadata:metadata()},1);s.settings.thresholdLow=0.9;s.settings.normalization='log'
  events.data({metadata:metadata('Te','K')},1)
  assert.equal(s.parameter,'Te');assert.equal(s.settings.normalization,'linear');assert.equal(s.settings.thresholdLow,0)
  s.detach()
})
test('managed selection switches parameters only at the same UTC and excludes other fields from time choices', async () => {
  const {createPinia,setActivePinia}=require('pinia');setActivePinia(createPinia())
  const d={id:'d',imports:[{id:'ne0',status:'ready',timeIndex:0,timestamp:'2020-01-01T00:00:00Z'}, {id:'te0',parameter:'Te',status:'ready',timeIndex:0,timestamp:'2020-01-01T00:00:00Z'}, {id:'ti1',parameter:'Ti',status:'ready',timeIndex:1,timestamp:'2020-01-01T01:00:00Z'}],preview:{parameters:[{parameter:'Ne',available:true},{parameter:'Te',available:true},{parameter:'Ti',available:true}]}}
  const {useManagedVolumesStore}=load('../src/store/ionosphere/managedVolumes.ts',{'../../services/ionosphere/datasetApi':{fetchDatasets:async()=>({items:[d],total:1}),fetchDataset:async()=>d}})
  const s=useManagedVolumesStore();await s.refresh('ne0')
  assert.equal(typeof s.selectParameter,'function')
  assert.deepEqual(s.readyImports.map(t=>t.id),['ne0'])
  s.selectParameter('Te');assert.equal(s.importId,'te0')
  s.selectParameter('Ti');assert.equal(s.importId,undefined)
  assert.equal(s.parameterOptions.find(p=>p.parameter==='Ti').selectable,true)
  assert.deepEqual(s.readyImports.map(t=>t.id),['ti1'])
  assert.equal(s.parameterOptions.find(p=>p.parameter==='Ti').state,'当前时刻未入库')
  s.dispose()
})
test('dataset store submits and cancels the selected parameter, preserving other task records', async () => {
  const {createPinia,setActivePinia}=require('pinia');setActivePinia(createPinia())
  const calls=[], d={id:'d',status:'preview',imports:[{id:'ne',timeIndex:0,status:'ready'}],preview:{times:[{index:0}],parameters:[{parameter:'Te',available:true}]}}
  const api={fetchDataset:async()=>d,importDataset:async(...args)=>{calls.push(args);return {id:'te',parameter:'Te',timeIndex:0,status:'queued'}},cancelDatasetImports:async(...args)=>{calls.push(args);return {tasks:[],cancelled:0}}}
  const s=load('../src/store/ionosphere/datasets.ts',{'../../services/ionosphere/datasetApi':api}).useDatasetStore()
  await s.selectDataset('d');s.parameter='Te';await s.createImport();await s.cancelBatch([0])
  assert.deepEqual(calls.map(c=>c[3]),['Te','Te']);assert.equal(s.selected.imports.length,2);s.dispose()
})
test('3D scientific labels and source selector are metadata-driven, not fixed Ne', () => {
  const read=p=>fs.readFileSync(path.resolve(__dirname,'../src',p),'utf8')
  assert.match(read('components/ionosphere/ManagedVolumeSource.vue'),/catalog\.parameterOptions/)
  for (const p of ['VolumeLegend.vue','VolumeProbePanel.vue','VolumeControlPanel.vue','SectionPlot.vue']) {
    const source=read('components/ionosphere/'+p)
    assert.match(source,/parameterLabel|parameterName/)
    assert.doesNotMatch(source,/Electron Density <b>Ne|<dt>电子密度 Ne<|· Ne \$\{scientific/)
    const {parse,compileTemplate}=require('vue/compiler-sfc'), {descriptor}=parse(source)
    assert.deepEqual(compileTemplate({source:descriptor.template.content,id:p,filename:p}).errors,[])
  }
  assert.match(read('views/data-management/index.vue'),/store\.parameter/)
  assert.match(read('components/ionosphere/BatchImportPanel.vue'),/parameter/)
})
test('parameter changes keep same-file height clipping and drawn section but clear stale scalar samples', () => {
  const {createPinia,setActivePinia}=require('pinia');setActivePinia(createPinia());let events
  class Controller {constructor(r,e){events=e}clear(){}destroy(){}configure(){}load(){}cancelRegionSelection(){}cancelSectionSelection(){}}
  const s=load('../src/store/ionosphere/volume.ts',{'../../cesium/ionosphere/IonosphereVolumeController':{IonosphereVolumeController:Controller}}).useVolumeStore()
  s.attach({});events.data({metadata:{...metadata(),sourceSha256:'a'.repeat(64)}},1)
  s.settings.altitudeRange=[200,400];s.settings.section={kind:'path',longitude:118,latitude:37,path:[{longitude:100,latitude:20},{longitude:110,latitude:30}],visible:true}
  const previous=JSON.parse(JSON.stringify(s.settings.section));s.selectedPoint={value:42}
  s.selectImport('te');events.data({metadata:{...metadata('Te','K'),sourceSha256:'a'.repeat(64)}},1)
  assert.deepEqual(s.settings.altitudeRange,[200,400]);assert.deepEqual(s.settings.section,previous);assert.equal(s.selectedPoint,null);s.detach()
})
test('a rapid return to the original parameter still restores spatial context',()=>{
  const {createPinia,setActivePinia}=require('pinia');setActivePinia(createPinia());let events
  class Controller {constructor(r,e){events=e}clear(){}destroy(){}configure(){}load(){}cancelRegionSelection(){}cancelSectionSelection(){}}
  const s=load('../src/store/ionosphere/volume.ts',{'../../cesium/ionosphere/IonosphereVolumeController':{IonosphereVolumeController:Controller}}).useVolumeStore()
  const m={...metadata(),sourceSha256:'a'.repeat(64)}
  s.attach({});events.data({metadata:m},1);s.settings.altitudeRange=[200,400]
  s.selectImport('te');s.selectImport('ne');events.data({metadata:m},1)
  assert.deepEqual(s.settings.altitudeRange,[200,400]);s.detach()
})
for (const next of ['Ne','Ti']) test(`new uploads select an available physical parameter (${next}) instead of stale Te`,async()=>{
  const {createPinia,setActivePinia}=require('pinia');setActivePinia(createPinia())
  const d={id:'new',status:'preview',imports:[],preview:{times:[{index:0}],parameters:[{parameter:next,available:true}]}}
  const api={uploadDataset:async()=>({...d,status:'inspecting',preview:null}),fetchDatasets:async()=>({items:[d],total:1}),fetchDataset:async()=>d}
  const s=load('../src/store/ionosphere/datasets.ts',{'../../services/ionosphere/datasetApi':api}).useDatasetStore()
  s.parameter='Te';await s.upload(new File(['test'],'qa.nc'));assert.equal(s.parameter,next);s.dispose()
})
