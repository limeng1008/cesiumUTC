const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),path=require('node:path'),Module=require('node:module')
function load(file,mocks={}) {
 const filename=path.resolve(__dirname,file);assert.ok(fs.existsSync(filename),'batch import implementation must exist')
 const m=new Module(filename,module);m.paths=Module._nodeModulePaths(path.dirname(filename));const original=m.require.bind(m)
 m.require=id=>mocks[id]??(id.startsWith('.')?load(path.relative(__dirname,path.resolve(path.dirname(filename),id+'.ts')),mocks):original(id))
 m._compile(ts.transpileModule(fs.readFileSync(filename,'utf8').replaceAll('import.meta.env.VITE_BASE_API',"'/api/v1'"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,filename)
 return m.exports
}
const times=Array.from({length:6},(_,index)=>({index,timestamp:new Date(Date.UTC(2019,3,25,0,index*10)).toISOString()}))
const dataset={id:'file',status:'preview',imports:[],preview:{times}}
test('UTC batch selection is inclusive, deterministic and uses every N source timestamps',()=>{
 const api=load('../src/utils/ionosphere/batchImport.ts')
 assert.deepEqual(api.selectBatchTimes(times,'2019-04-25T00:10','2019-04-25T00:50',2).map(t=>t.index),[1,3,5])
 assert.equal(api.selectBatchTimes(times,'2019-04-25T00:00','2019-04-25T00:50',1).length,6)
 assert.throws(()=>api.selectBatchTimes(times,'2019-04-25T00:50','2019-04-25T00:00',1),/时间/)
 assert.throws(()=>api.selectBatchTimes(times,'2019-04-25T00:00','2019-04-25T00:50',0),/间隔/)
})
test('batch summary separates ready, queued, processing, failed, cancelled and absent',()=>{
 const api=load('../src/utils/ionosphere/batchImport.ts')
 const tasks=['ready','queued','processing','failed','cancelled'].map((status,timeIndex)=>({status,timeIndex,progress:20}))
 const s=api.batchSummary(times,tasks)
 assert.deepEqual([s.ready,s.queued,s.processing,s.failed,s.cancelled,s.unimported],[1,1,1,1,1,1])
 assert.equal(s.total,6);assert.equal(s.settled,3)
})
test('batch and cancellation APIs send authenticated explicit indices',async()=>{
 const api=load('../src/services/ionosphere/datasetApi.ts',{'../../utils/auth/token':{getToken:()=> 'token'}})
 assert.equal(typeof api.importDatasetBatch,'function');assert.equal(typeof api.cancelDatasetImports,'function')
 const original=global.fetch,calls=[];global.fetch=async(url,options)=>{calls.push({url,options});return{ok:true,json:async()=>({code:200,data:{tasks:[],queued:0,skipped:1}})}}
 try{await api.importDatasetBatch('file',[0,2]);await api.cancelDatasetImports('file',[2]);assert.ok(calls[0].url.endsWith('/imports/batch'));assert.ok(calls[1].url.endsWith('/imports/cancel'));assert.deepEqual(JSON.parse(calls[0].options.body),{timeIndices:[0,2]});assert.equal(calls[0].options.headers.token,'token')}finally{global.fetch=original}
})
test('batch store publishes returned tasks and disposal ignores late submission',async()=>{
 const {createPinia,setActivePinia}=require('pinia');setActivePinia(createPinia())
 let resolve
 const s=load('../src/store/ionosphere/datasets.ts',{'../../services/ionosphere/datasetApi':{fetchDataset:async()=>({...dataset}),importDatasetBatch:()=>new Promise(r=>{resolve=r}),cancelDatasetImports:async()=>({tasks:[{id:'t',timeIndex:0,status:'cancelled'}],cancelled:1})}}).useDatasetStore()
 assert.equal(typeof s.createBatch,'function');await s.selectDataset('file')
 const pending=s.createBatch([0]);resolve({tasks:[{id:'t',timeIndex:0,status:'queued'}],queued:1,skipped:0});await pending
 assert.equal(s.selected.imports[0].status,'queued');assert.equal(s.hasActiveWork,true)
 await s.cancelBatch([0]);assert.equal(s.selected.imports[0].status,'cancelled');assert.equal(s.hasActiveWork,false)
 const late=s.createBatch([0]);s.dispose();resolve({tasks:[{id:'t',timeIndex:0,status:'queued'}],queued:1,skipped:0});await late;assert.equal(s.selected,null)
})
test('batch panel compiles and exposes range, retry, cancellation and time-window navigation',()=>{
 const file=path.resolve(__dirname,'../src/components/ionosphere/BatchImportPanel.vue');assert.ok(fs.existsSync(file),'batch panel must exist')
 const {parse,compileScript,compileTemplate}=require('vue/compiler-sfc'),source=fs.readFileSync(file,'utf8'),{descriptor}=parse(source)
 const script=compileScript(descriptor,{id:'batch'})
 assert.deepEqual(compileTemplate({source:descriptor.template.content,id:'batch',filename:file,compilerOptions:{bindingMetadata:script.bindings}}).errors,[])
 for(const text of ['datetime-local','取消','失败','/time-variation','start','end'])assert.ok(source.includes(text),text)
})
