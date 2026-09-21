const ts = require('typescript')
const fs = require('node:fs')
const assert = require('node:assert/strict')
const { test } = require('node:test')
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file)
const math = require('../src/utils/ionosphere/interpolation.ts')
const { normalize, valueRange } = require('../src/utils/ionosphere/normalize.ts')
const { validateMetadata, decodeVolume } = require('../src/models/ionosphere/validation.ts')
const { defaultSettings } = require('../src/models/ionosphere/IonosphereVolume.ts')
const model = require('../src/models/ionosphere/IonosphereVolume.ts')
test('default and reset palettes run from low blue to high red for every source',()=>{
  assert.equal(defaultSettings().colorMap,'blue-red')
  assert.equal(defaultSettings({minValue:7.7e7,maxValue:1.71e12,altitude:{min:90,max:1000}}).colorMap,'blue-red')
})
const { colorAt, alphaAt, transfer, colorLUT, colorGLSL } = require('../src/cesium/ionosphere/shader/transferFunction.ts')
const { createVoxelProvider } = require('../src/cesium/ionosphere/provider/IonosphereVoxelProvider.ts')
const { qualitySettings } = require('../src/cesium/ionosphere/renderer/CesiumVoxelRenderer.ts')
const picking = require('../src/cesium/ionosphere/interaction/IonospherePicking.ts')
const axis = (min,max,count) => ({min,max,count,step:(max-min)/count})
const metadata = {parameter:'Ne',parameterName:'Electron Density',unit:'m^-3',longitude:axis(-180,180,4),latitude:axis(-90,90,2),altitude:axis(80,1000,2),minValue:1,maxValue:114,sampling:'cell-center',altitudeUnit:'km',order:'zyx',dtype:'float32',byteOrder:'little',source:'deterministic-mock',id:'test',byteLength:64}
const volume = {metadata,values:Float32Array.from({length:16},(_,i)=>1+i%4+10*(Math.floor(i/4)%2)+100*Math.floor(i/8))}
test('X longitude fastest, then Y latitude, then Z altitude',()=>assert.equal(math.gridIndex(3,1,1,4,2),15))
test('longitude wraps +180/-180 and multiple cycles',()=>{assert.equal(math.wrapLongitude(180),-180);assert.equal(math.wrapLongitude(541),-179)})
test('cell center fractional axis indices',()=>{assert.equal(math.axisCoordinate(-135,metadata.longitude),0);assert.equal(math.axisCoordinate(540,metadata.altitude),0.5);assert.equal(math.axisCoordinate(0,metadata.latitude),0.5)})
test('trilinear is exact for affine field between eight centers',()=>assert.equal(math.sampleVolume(volume,-90,0,540),56.5))
test('longitude seam interpolates last and first cells',()=>{assert.equal(math.sampleVolume(volume,180,0,540),57.5);assert.equal(math.sampleVolume(volume,-180,0,540),57.5)})
test('boundary centers extend to physical domain edge',()=>{assert.equal(math.sampleVolume(volume,-135,-90,80),1);assert.equal(math.sampleVolume(volume,-135,90,1000),111)})
test('outside latitude/altitude and nonfinite coordinate return null',()=>{for(const p of [[0,91,300],[0,0,79],[NaN,0,300],[0,0,Infinity]])assert.equal(math.sampleVolume(volume,...p),null)})
test('nearest retained as explicit option',()=>assert.equal(math.sampleVolume(volume,-130,-40,310,'nearest'),1))
test('noData neighbors with positive weight invalidate interpolation',()=>{const v={metadata:{...metadata,noDataValue:-999},values:volume.values.slice()};v.values[0]=-999;assert.equal(math.sampleVolume(v,-90,0,540),null);assert.equal(math.sampleVolume(v,135,45,770),114)})
test('linear/log normalization and degenerate/invalid inputs',()=>{assert.equal(normalize(1e10,[1e8,1e12],'log'),0.5);assert.equal(normalize(5,[0,10],'linear'),0.5);assert.equal(normalize(0,[1,10],'log'),0);assert.equal(normalize(5,[5,5],'linear'),0);assert.equal(normalize(100,[0,10],'linear'),1)})
test('range excludes noData, rejects NaN and empty data',()=>{assert.deepEqual(valueRange(new Float32Array([2,1,-999,3]),-999),[1,3]);assert.throws(()=>valueRange(new Float32Array([NaN])));assert.throws(()=>valueRange(new Float32Array()))})
test('metadata rejects dimension/step/unit mismatch',()=>{assert.equal(validateMetadata(metadata).longitude.count,4);for(const bad of [{...metadata,altitudeUnit:'m'},{...metadata,longitude:{...metadata.longitude,step:1}},{...metadata,byteLength:1}])assert.throws(()=>validateMetadata(bad))})
test('binary length and actual min/max checked',()=>{assert.equal(decodeVolume(metadata,volume.values.buffer).values.length,16);assert.throws(()=>decodeVolume(metadata,new ArrayBuffer(8)));const v=volume.values.slice();v[0]=NaN;assert.throws(()=>decodeVolume(metadata,v.buffer));assert.throws(()=>decodeVolume({...metadata,maxValue:100},volume.values.buffer))})
test('all three LUTs have exact endpoints and continuous midpoints',()=>{for(const map of Object.keys(colorLUT)){assert.deepEqual(colorAt(0,map),colorLUT[map][0]);assert.deepEqual(colorAt(1,map),colorLUT[map].at(-1));assert.ok(colorAt(.5,map).every(x=>x>=0&&x<=1))}assert.ok(colorGLSL().includes('vec3 scientificColor'))})
test('alpha independent of color, threshold and filter are effective',()=>{const s=defaultSettings();assert.equal(alphaAt(.2,.3,.8,.65),0);assert.equal(alphaAt(1,.3,.8,.65),.65);assert.equal(transfer(1e7,s)[3],0);assert.equal(transfer(null,s)[3],0);assert.equal(transfer(1e12,{...s,opacity:0})[3],0);assert.deepEqual(transfer(1e12,s).slice(0,3),colorAt(1,s.colorMap))})
test('quality maps to real monotonic raymarch and SSE values',()=>{assert.ok(qualitySettings.performance.stepSize>qualitySettings.standard.stepSize);assert.ok(qualitySettings.standard.stepSize>qualitySettings.high.stepSize);assert.ok(qualitySettings.performance.screenSpaceError>qualitySettings.high.screenSpaceError)})
test('provider creates periodic halos and preserves X/Y/Z order',async()=>{const C=await import('cesium');const provider=createVoxelProvider(C,volume);assert.equal(provider.dimensions.x,4);assert.equal(provider.paddingBefore.x,1);const content=await provider.requestData({tileLevel:0});assert.deepEqual(Array.from(content.metadata[0].slice(0,6)),[4,1,2,3,4,1]);assert.equal(content.metadata[0][6*2],104);assert.equal(provider.requestData({tileLevel:1}),undefined);assert.equal(provider.minBounds.z,80000);assert.equal(provider.maxBounds.z,1000000)})
test('GPU uses a neutral scalar channel for Kelvin and retains valid zero density',async()=>{
 const C=await import('cesium'),v={metadata:{...metadata,parameter:'Te',unit:'K'},values:new Float32Array(16).fill(1000)}
 const provider=createVoxelProvider(C,v);assert.deepEqual(provider.names,['scalar','valid'])
 const zero=createVoxelProvider(C,{metadata:{...metadata,minValue:0},values:new Float32Array(16)}),content=await zero.requestData({tileLevel:0})
 assert.equal(content.metadata[0][1],0);assert.equal(content.metadata[1][1],1)
 const {ionosphereVoxelShader}=require('../src/cesium/ionosphere/shader/ionosphereVoxelShader.ts');assert.match(ionosphereVoxelShader,/metadata.scalar/)
})
test('limb ray samples visible layer even when it misses the layer center', async()=>{
  const C=await import('cesium'), r=C.Ellipsoid.WGS84.maximumRadius
  const ray=new C.Ray(new C.Cartesian3(r+450000,-10000000,0),new C.Cartesian3(0,1,0))
  const viewer={camera:{getPickRay:()=>ray}}, pixel=new C.Cartesian2()
  assert.equal(picking.pickHeight(C,viewer,pixel,439.375),null)
  assert.equal(typeof picking.pickVolumeRay,'function')
  const s={...defaultSettings(),valueRange:[1,120],thresholdLow:0,altitudeRange:[425,453.75],opacity:0.01}
  const hit=picking.pickVolumeRay(C,viewer,pixel,volume,s)
  assert.ok(hit)
  assert.ok(hit.altitude>=450 && hit.altitude<=453.75)
  assert.ok(Math.abs(hit.longitude)<2)
})
test('ray probe obeys clipping, transparency and Earth occlusion',async()=>{
  const C=await import('cesium'), r=C.Ellipsoid.WGS84.maximumRadius
  const ray=new C.Ray(new C.Cartesian3(r+10000000,0,0),new C.Cartesian3(-1,0,0))
  const viewer={camera:{getPickRay:()=>ray}}, pixel=new C.Cartesian2()
  assert.equal(typeof picking.pickVolumeRay,'function')
  const s={...defaultSettings(),valueRange:[1,120],thresholdLow:0,altitudeRange:[200,500]}
  const hit=picking.pickVolumeRay(C,viewer,pixel,volume,s)
  assert.ok(hit && Math.abs(hit.longitude)<1e-6 && hit.altitude>=200 && hit.altitude<=500)
  assert.equal(picking.pickVolumeRay(C,viewer,pixel,volume,{...s,opacity:0}),null)
  assert.equal(picking.pickVolumeRay(C,viewer,pixel,volume,{...s,valueRange:[200,300]}),null)
})
test('render settings never propagate empty, nonfinite or zero-width numeric ranges',()=>{
  assert.equal(typeof model.sanitizeSettings,'function')
  const s=model.sanitizeSettings({...defaultSettings(),altitudeRange:[500,500],valueRange:['',Infinity],sliceAltitude:NaN,opacity:Infinity,thresholdLow:1,thresholdHigh:0})
  assert.ok(s.altitudeRange[1]>s.altitudeRange[0])
  assert.ok(s.valueRange.every(Number.isFinite) && s.valueRange[1]>s.valueRange[0] && s.valueRange[0]>0)
  assert.ok(Number.isFinite(s.sliceAltitude) && Number.isFinite(s.opacity))
  assert.ok(s.thresholdHigh>s.thresholdLow)
  const valid={...defaultSettings(),valueRange:[100000224,908818776064]}
  assert.deepEqual(model.sanitizeSettings(valid),valid)
})
const samiMetadata = {...metadata,source:'sami3-model',sourceName:'SAMI3 模型数据',timestamp:'2019-04-25T00:00:00Z',altitude:axis(90,1000,2),noDataValue:-999,validDomain:{latitudeMin:-89,latitudeMax:88.5,altitudeMin:90,altitudeMax:1000}}
test('SAMI3 valid domain excludes padded poles in both interpolation modes',()=>{
  const v={...volume,metadata:samiMetadata}
  for(const method of ['nearest','trilinear']) {
    for(const latitude of [-90,-89.01,88.51,90]) assert.equal(math.sampleVolume(v,0,latitude,300,method),null)
    for(const latitude of [-89,88.5]) assert.ok(math.sampleVolume(v,0,latitude,300,method)>0)
    assert.equal(math.sampleVolume(v,0,0,89,method),null)
  }
})
test('metadata validates physical domain and model provenance',()=>{
  assert.equal(validateMetadata(samiMetadata).timestamp,'2019-04-25T00:00:00Z')
  for(const validDomain of [null,{...samiMetadata.validDomain,latitudeMin:-91},{...samiMetadata.validDomain,latitudeMax:-89},{...samiMetadata.validDomain,altitudeMin:80},{...samiMetadata.validDomain,altitudeMax:NaN}])
    assert.throws(()=>validateMetadata({...samiMetadata,validDomain}))
  assert.throws(()=>validateMetadata({...samiMetadata,timestamp:'not a time'}))
  assert.throws(()=>validateMetadata({...samiMetadata,sourceSha256:'invalid'}))
})
test('SAMI3 default and sanitized settings use metadata altitude bounds',()=>{
  assert.deepEqual(model.defaultSettings(samiMetadata).altitudeRange,[90,1000])
  const safe=model.sanitizeSettings({...defaultSettings(),altitudeRange:[0,Infinity],sliceAltitude:80},samiMetadata)
  assert.deepEqual(safe.altitudeRange,[90,1000])
  assert.equal(safe.sliceAltitude,90)
})
test('GPU latitude clipping follows the scientific domain',async()=>{
  const C=await import('cesium')
  const { CesiumVoxelRenderer } = require('../src/cesium/ionosphere/renderer/CesiumVoxelRenderer.ts')
  const renderer={C,primitive:{},volume:{metadata:samiMetadata},viewer:{scene:{requestRender(){}}}}
  CesiumVoxelRenderer.prototype.setAltitudeRange.call(renderer,90,1000)
  assert.ok(Math.abs(renderer.primitive.minClippingBounds.y-C.Math.toRadians(-89))<1e-12)
  assert.ok(Math.abs(renderer.primitive.maxClippingBounds.y-C.Math.toRadians(88.5))<1e-12)
})
