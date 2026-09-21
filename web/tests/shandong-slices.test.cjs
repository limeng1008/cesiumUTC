const ts=require('typescript'), fs=require('node:fs'), path=require('node:path')
const assert=require('node:assert/strict'), {test}=require('node:test')
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,f)
test('Shandong mock is repeatable, smooth, peaks at 300km and fades at edges',()=>{
  const file='../src/services/ionosphere/shandongMock.ts'
  assert.ok(fs.existsSync(path.resolve(__dirname,file)), 'dedicated deterministic Shandong field exists')
  const {shandongDensity,createShandongVolume}=require(file)
  const a=createShandongVolume(), b=createShandongVolume()
  assert.deepEqual(a.values,b.values)
  assert.equal(a.metadata.longitude.min,114);assert.equal(a.metadata.longitude.max,122)
  assert.equal(a.metadata.latitude.min,34);assert.equal(a.metadata.latitude.max,40.5)
  const peak=shandongDensity(117.5,36.8,300)
  for(const h of [100,200,400]) assert.ok(shandongDensity(117.5,36.8,h)<peak)
  assert.ok(shandongDensity(114,34,300)<peak*.01)
  assert.ok(Math.abs(shandongDensity(117.5,36.8,300)-shandongDensity(117.501,36.8,300))<peak*.01)
  assert.ok(a.values.every(Number.isFinite))
  let lo=Infinity,hi=-Infinity
  for(const v of a.values){lo=Math.min(lo,v);hi=Math.max(hi,v)}
  assert.equal(a.metadata.minValue,lo);assert.equal(a.metadata.maxValue,hi)
})
test('regional sampling never wraps western/eastern edges and defaults show four layers',()=>{
  const {sampleVolume}=require('../src/utils/ionosphere/interpolation.ts')
  const axis=(min,max,count)=>({min,max,count,step:(max-min)/count})
  const volume={metadata:{longitude:axis(114,122,2),latitude:axis(34,40.5,1),altitude:axis(100,400,1)},values:new Float32Array([1,9])}
  assert.equal(sampleVolume(volume,114,37,300),1)
  assert.equal(sampleVolume(volume,122,37,300),9)
  assert.equal(sampleVolume(volume,113.99,37,300),null)
  assert.equal(sampleVolume(volume,122.01,37,300),null)
  assert.equal(sampleVolume(volume,118,37,300),5)
  const {defaultSettings}=require('../src/models/ionosphere/IonosphereVolume.ts')
  const settings=defaultSettings({...volume.metadata,source:'shandong-mock',minValue:1e8,maxValue:1e12})
  assert.equal(settings.volumeVisible,false)
  assert.equal(settings.sliceVisible,true)
  assert.equal(settings.sliceMode,'multiple')
  assert.equal(settings.normalization,'linear')
  assert.ok(settings.opacity>=.25&&settings.opacity<=.45)
  assert.deepEqual(settings.region,{west:114,east:122,south:34,north:40.5})
})
test('analysis envelope is six translucent faces plus top bottom and four upright edges at true heights',async()=>{
  const file='../src/cesium/ionosphere/renderer/RegionalContext.ts'
  assert.ok(fs.existsSync(path.resolve(__dirname,file)), 'regional context geometry exists')
  const C=await import('cesium'), {makeEnvelopeGeometry}=require(file)
  const geometry=makeEnvelopeGeometry(C,{west:114,east:122,south:34,north:40.5},100,400)
  assert.equal(geometry.faces.length,6)
  assert.equal(geometry.edges.length,6)
  for(const [index,height] of [[0,100000],[1,400000]]) {
    const g=C.RectangleGeometry.createGeometry(geometry.faces[index].geometry)
    const position=C.Cartesian3.fromArray(g.attributes.position.values)
    assert.ok(Math.abs(C.Cartographic.fromCartesian(position).height-height)<.001)
  }
  for(const edge of geometry.edges.slice(2)) {
    const positions=edge.geometry._positions
    assert.ok(Math.abs(C.Cartographic.fromCartesian(positions[0]).height-100000)<.001)
    assert.ok(Math.abs(C.Cartographic.fromCartesian(positions[1]).height-400000)<.001)
  }
})
test('bundled boundary is Shandong and covers a real multi-polygon outline',()=>{
  const boundary=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../public/data/shandong-boundary.geojson'),'utf8'))
  assert.equal(boundary.type,'FeatureCollection')
  assert.equal(boundary.features[0].properties.adcode,370000)
  assert.equal(boundary.features[0].geometry.type,'MultiPolygon')
  assert.ok(boundary.features[0].geometry.coordinates[0][0].length>100)
})
test('Shandong render path creates slices and context without constructing a VoxelPrimitive',()=>{
  const {CesiumVoxelRenderer}=require('../src/cesium/ionosphere/renderer/CesiumVoxelRenderer.ts')
  const {createShandongVolume}=require('../src/services/ionosphere/shandongMock.ts')
  const volume=createShandongVolume(), calls=[]
  const renderer={C:{VoxelPrimitive:class{constructor(){throw new Error('Voxel not allowed in slice preview')}}},settings:{},clearVolume(){},configure(){calls.push('slices')},regionalContext:{load(){calls.push('context')}},focusRegion(){calls.push('camera')},events:{ready(){calls.push('ready')}}}
  CesiumVoxelRenderer.prototype.load.call(renderer,volume)
  assert.equal(renderer.ready,true)
  assert.deepEqual(calls,['slices','camera','ready'])
})
test('slice teardown releases its owned texture material exactly once',()=>{
  const {HeightSlice}=require('../src/cesium/ionosphere/renderer/HeightSlice.ts')
  let materials=0,primitives=0,listeners=0
  const slice={material:{isDestroyed:()=>false,destroy(){materials++}},primitive:{},removeWarmup(){listeners++},viewer:{isDestroyed:()=>false,scene:{primitives:{remove(){primitives++}}}}}
  HeightSlice.prototype.destroy.call(slice)
  HeightSlice.prototype.destroy.call(slice)
  assert.equal(materials,1)
  assert.equal(primitives,1)
  assert.equal(listeners,1)
})
