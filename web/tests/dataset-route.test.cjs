const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const Module=require('node:module')
const ts=require('typescript')
const vue=require('vue')
const {parse,compileScript}=require('vue/compiler-sfc')
test('volume route observes URL but store teardown cannot rewrite another route',async()=>{
  const filename=path.resolve(__dirname,'../src/components/ionosphere/VolumeScene.vue')
  const {descriptor}=parse(fs.readFileSync(filename,'utf8'),{filename})
  const content=compileScript(descriptor,{id:'managed-volume-route'}).content
  const route=vue.reactive({query:{importId:'task-a'}}),calls=[]
  const store=vue.reactive({importId:undefined,selectImport(id){calls.push(id);this.importId=id}})
  const router={replace(target){route.query=target.query}}
  const m=new Module(filename,module)
  m.require=id=>id==='vue'?{...vue,onBeforeUnmount(){}}:id==='vue-router'?{useRoute:()=>route,useRouter:()=>router}:id==='@/store/ionosphere/volume'?{useVolumeStore:()=>store}:{}
  m._compile(ts.transpileModule(content,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,filename)
  const scope=vue.effectScope()
  scope.run(()=>m.exports.default.setup({}, {expose(){}}))
  assert.deepEqual(calls,['task-a'])
  route.query={importId:'task-b'};await vue.nextTick()
  assert.equal(store.importId,'task-b')
  store.importId=undefined;await vue.nextTick();await vue.nextTick()
  assert.equal(route.query.importId,'task-b')
  route.query={};await vue.nextTick()
  assert.equal(calls.at(-1),undefined)
  scope.stop()
})
