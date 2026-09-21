const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript')
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,f)
const axis=(min,max,count)=>({min,max,count,step:(max-min)/count})
const meta={id:'ranges',longitude:axis(0,4,4),latitude:axis(0,4,4),altitude:axis(100,500,4),minValue:165,maxValue:555,noDataValue:-999}
const values=Float32Array.from({length:64},(_,i)=>100+Math.floor(i/16)*100+50+(Math.floor(i/4)%4+.5)*10+(i%4+.5)*20)
const volume={metadata:meta,values},settings={region:{west:1,east:3,south:1,north:3},altitudeRange:[200,400],normalization:'linear'}
const api=()=>{const f=path.resolve(__dirname,'../src/utils/ionosphere/valueRange.ts');assert.ok(fs.existsSync(f),'range statistics module exists');return require(f)}
test('regional range includes interpolated crop boundaries and excludes exterior extrema',()=>{
 const {regionalValueRange}=api();const r=regionalValueRange(volume,settings)
 assert.deepEqual(r.range,[230,490]);assert.ok(r.count>0)
 assert.deepEqual(regionalValueRange(volume,{...settings,region:{west:10,east:12,south:1,north:3}}).range,null)
})
test('range handles noData, constant fields and logarithmic invalid samples',()=>{
 const {regionalValueRange,expandedRange}=api()
 const constant={metadata:meta,values:new Float32Array(64).fill(5)}
 assert.deepEqual(regionalValueRange(constant,settings).range,[5,5])
 const expanded=expandedRange([5,5]);assert.ok(expanded[0]<expanded[1]);assert.ok(expanded[0]<=5&&expanded[1]>=5)
 for(const v of [NaN,Infinity,-999])assert.equal(regionalValueRange({...constant,values:new Float32Array(64).fill(v)},settings).range,null)
 assert.equal(regionalValueRange({...constant,values:new Float32Array(64).fill(0)},{...settings,normalization:'log'}).range,null)
})
test('nearest statistics use the same interpolator as the rendered field',()=>{
 const result=api().regionalValueRange(volume,{...settings,region:{west:1.1,east:1.2,south:1.1,north:1.2},altitudeRange:[210,220],interpolation:'nearest'})
 assert.deepEqual(result.range,[295,295])
})
test('zero and sub-unit linear ranges survive renderer sanitization unchanged',()=>{
 const {defaultSettings,sanitizeSettings}=require('../src/models/ionosphere/IonosphereVolume.ts')
 const {transfer}=require('../src/cesium/ionosphere/shader/transferFunction.ts')
 for(const range of [[0,1],[.01,.02],[0,1e-12],[1e10,1e10+1024]]){
   const settings={...defaultSettings(),normalization:'linear',valueRange:range}
   assert.deepEqual(sanitizeSettings(settings).valueRange,range)
   assert.ok(transfer(range[0],sanitizeSettings(settings))[3]>0)
 }
 assert.equal(transfer(0,{...defaultSettings(),normalization:'log',valueRange:[0,1]})[3],0)
 assert.equal(transfer(NaN,defaultSettings())[3],0)
})
test('global range excludes log zero and invalid data, and expands constants only slightly',()=>{
 const {globalValueRange,expandedRange}=api()
 assert.equal(typeof globalValueRange,'function')
 const v={metadata:{...meta,minValue:0,maxValue:5},values:Float32Array.from([0,.5,5,-999,NaN,Infinity])}
 assert.deepEqual(globalValueRange(v,'linear').range,[0,5])
 assert.deepEqual(globalValueRange(v,'log').range,[.5,5])
 assert.equal(globalValueRange({...v,values:Float32Array.from([0,-999,NaN])},'log').range,null)
 assert.ok(expandedRange([5,5])[1]-5<.0001)
 const {sanitizeSettings,defaultSettings}=require('../src/models/ionosphere/IonosphereVolume.ts')
 for(const n of [0,.01,5]){
  const range=expandedRange([n,n])
  assert.deepEqual(sanitizeSettings({...defaultSettings(),normalization:'linear',valueRange:range}).valueRange,range)
 }
})
