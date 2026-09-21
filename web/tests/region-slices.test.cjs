const ts = require('typescript')
const fs = require('node:fs')
const assert = require('node:assert/strict')
const { test } = require('node:test')
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file)
const model = require('../src/models/ionosphere/IonosphereVolume.ts')
const tf = require('../src/cesium/ionosphere/shader/transferFunction.ts')
test('multi slices have finite sorted unique domain-limited heights and at most four layers', () => {
  const defaults = model.defaultSettings()
  assert.deepEqual(defaults.sliceAltitudes, [100,200,300,400])
  const s = model.sanitizeSettings({...defaults, sliceAltitudes:[400,200,200,NaN,40,1500,300,100]})
  assert.deepEqual(s.sliceAltitudes,[100,200,300,400])
  const restricted = {minValue:1,maxValue:10,altitude:{min:500,max:600}}
  assert.deepEqual(model.defaultSettings(restricted).sliceAltitudes,[550])
  assert.deepEqual(model.sanitizeSettings({...defaults,sliceAltitudes:[]},restricted).sliceAltitudes,[550])
})
test('default low blue is visible, below threshold/noData/outside range still invisible', () => {
  const s = model.defaultSettings()
  assert.equal(s.thresholdLow,0)
  assert.equal(s.lowValueOpacity,0.08)
  assert.ok(tf.transfer(s.valueRange[0],s)[3]>0)
  assert.equal(tf.transfer(s.valueRange[0],{...s,thresholdLow:0.2})[3],0)
  assert.equal(tf.transfer(null,s)[3],0)
  assert.equal(tf.transfer(s.valueRange[0]/2,s)[3],0)
  assert.equal(tf.transfer(s.valueRange[0],{...s,opacity:0})[3],0)
  assert.equal(tf.transfer(s.valueRange[0],{...s,lowValueOpacity:0})[3],0)
})
test('region sanitizer rejects degeneracy and nonfinite bounds without broadening data', () => {
  const s = model.defaultSettings()
  assert.equal(s.region,null)
  for(const region of [{west:10,east:10,south:20,north:30},{west:1,east:2,south:30,north:20},{west:NaN,east:2,south:1,north:2}])
    assert.equal(model.sanitizeSettings({...s,region}).region,null)
})
test('drawing chooses short rectangle including antimeridian and inclusive edges', () => {
  const path = '../src/utils/ionosphere/region.ts'
  assert.ok(fs.existsSync(require('node:path').resolve(__dirname,path)), 'region math module exists')
  const {regionFromCorners, containsRegion, longitudeSpan} = require(path)
  assert.deepEqual(regionFromCorners({longitude:120,latitude:40},{longitude:110,latitude:30}),{west:110,east:120,south:30,north:40})
  const r=regionFromCorners({longitude:170,latitude:40},{longitude:-170,latitude:30})
  assert.deepEqual(r,{west:170,east:-170,south:30,north:40})
  assert.equal(longitudeSpan(r),20)
  for(const lon of [170,175,180,-180,-175,-170]) assert.equal(containsRegion(r,lon,35),true)
  assert.equal(containsRegion(r,0,35),false)
  assert.equal(containsRegion(r,175,29),false)
  assert.equal(regionFromCorners({longitude:0,latitude:0},{longitude:0,latitude:1}),null)
})
test('visible slice heights obey clipping without mutating selected heights', () => {
  const path='../src/utils/ionosphere/slices.ts'
  assert.ok(fs.existsSync(require('node:path').resolve(__dirname,path)), 'slice rules module exists')
  const {visibleSliceHeights}=require(path)
  const s={...model.defaultSettings(),sliceVisible:true,sliceMode:'multiple',altitudeRange:[150,350]}
  assert.deepEqual(visibleSliceHeights(s),[200,300])
  assert.deepEqual(s.sliceAltitudes,[100,200,300,400])
  assert.deepEqual(visibleSliceHeights({...s,sliceVisible:false}),[])
  assert.deepEqual(visibleSliceHeights({...s,sliceMode:'single',sliceAltitude:400}),[])
})
const axis=(min,max,count)=>({min,max,count,step:(max-min)/count})
const metadata={parameter:'Ne',parameterName:'Ne',unit:'m^-3',longitude:axis(-180,180,4),latitude:axis(-90,90,2),altitude:axis(80,1000,4),minValue:1,maxValue:100,sampling:'cell-center',altitudeUnit:'km',order:'zyx',dtype:'float32',byteOrder:'little',source:'test',id:'test',byteLength:128}
const volume={metadata,values:new Float32Array(32).fill(50)}
test('ray picking excludes drawn-out regions even though source data exists', async()=>{
  const C=await import('cesium')
  const {pickVolumeRay}=require('../src/cesium/ionosphere/interaction/IonospherePicking.ts')
  const ray=new C.Ray(new C.Cartesian3(C.Ellipsoid.WGS84.maximumRadius+2000000,0,0),new C.Cartesian3(-1,0,0))
  const viewer={camera:{getPickRay:()=>ray}}
  const s={...model.defaultSettings(metadata),region:{west:10,east:20,south:-5,north:5}}
  assert.equal(pickVolumeRay(C,viewer,new C.Cartesian2(),volume,s),null)
})
test('slice ray chooses nearest visible layer, obeys region, clipping and Earth', async()=>{
  const C=await import('cesium')
  const picking=require('../src/cesium/ionosphere/interaction/IonospherePicking.ts')
  assert.equal(typeof picking.pickSlices,'function')
  const ray=new C.Ray(new C.Cartesian3(C.Ellipsoid.WGS84.maximumRadius+2000000,0,0),new C.Cartesian3(-1,0,0))
  const viewer={camera:{getPickRay:()=>ray}}
  const s={...model.defaultSettings(metadata),sliceVisible:true,sliceMode:'multiple',region:{west:-5,east:5,south:-5,north:5}}
  const pixel=new C.Cartesian2()
  assert.ok(Math.abs(picking.pickSlices(C,viewer,pixel,volume,s).altitude-400)<0.001)
  assert.ok(Math.abs(picking.pickSlices(C,viewer,pixel,volume,{...s,altitudeRange:[150,350]}).altitude-300)<0.001)
  assert.equal(picking.pickSlices(C,viewer,pixel,volume,{...s,opacity:0}),null)
  assert.equal(picking.pickSlices(C,viewer,pixel,volume,{...s,region:{west:170,east:-170,south:-5,north:5}}),null)
})
test('GPU clipping uses selected geographic bounds and original latitude validity', async()=>{
  const C=await import('cesium')
  const {CesiumVoxelRenderer}=require('../src/cesium/ionosphere/renderer/CesiumVoxelRenderer.ts')
  const renderer={C,primitive:{},settings:{...model.defaultSettings(),region:{west:170,east:-170,south:30,north:90}},volume:{metadata:{...metadata,validDomain:{latitudeMin:-89,latitudeMax:88.5}}},viewer:{scene:{requestRender(){}}}}
  CesiumVoxelRenderer.prototype.setAltitudeRange.call(renderer,100,400)
  assert.ok(Math.abs(renderer.primitive.minClippingBounds.x-C.Math.toRadians(170))<1e-12)
  assert.ok(Math.abs(renderer.primitive.maxClippingBounds.x-C.Math.toRadians(-170))<1e-12)
  assert.ok(Math.abs(renderer.primitive.maxClippingBounds.y-C.Math.toRadians(88.5))<1e-12)
})
test('slice raster samples selected rectangle with shared transfer and noData transparency',()=>{
  const path='../src/cesium/ionosphere/renderer/sliceRaster.ts'
  assert.ok(fs.existsSync(require('node:path').resolve(__dirname,path)), 'slice raster module exists')
  const {createSliceRaster}=require(path)
  const s={...model.defaultSettings(metadata),region:{west:170,east:-170,south:30,north:40}}
  const raster=createSliceRaster(volume,s,300,4,2)
  assert.deepEqual(raster.region,s.region)
  assert.equal(raster.pixels.length,32)
  const rgba=tf.transfer(50,s).map(v=>Math.round(v*255))
  assert.deepEqual(Array.from(raster.pixels.slice(0,4)),rgba)
  assert.equal(createSliceRaster(volume,s,79,4,2).pixels.every(v=>v===0),true)
  assert.equal(createSliceRaster(volume,{...s,opacity:0},300,4,2).pixels.every((v,i)=>i%4!==3||v===0),true)
})
test('slice collection reuses layers and removes deleted layers and height labels',async()=>{
  const path='../src/cesium/ionosphere/renderer/HeightSliceCollection.ts'
  assert.ok(fs.existsSync(require('node:path').resolve(__dirname,path)), 'slice collection exists')
  const C=await import('cesium')
  const {HeightSlice}=require('../src/cesium/ionosphere/renderer/HeightSlice.ts')
  // Only GPU upload is replaced; collection membership/lifecycle and Cesium labels are real.
  const oldUpdate=HeightSlice.prototype.update, oldDestroy=HeightSlice.prototype.destroy
  const alive=new Set(), removed=[]
  HeightSlice.prototype.update=function(){alive.add(this)}
  HeightSlice.prototype.destroy=function(){alive.delete(this);removed.push(this)}
  const primitives=new C.PrimitiveCollection()
  const viewer={scene:{primitives,requestRender(){}},isDestroyed:()=>false}
  const {HeightSliceCollection}=require(path)
  const collection=new HeightSliceCollection(C,viewer)
  const oldDocument=global.document
  const oldCanvas=global.HTMLCanvasElement, oldImage=global.HTMLImageElement
  const oldBitmap=global.ImageBitmap, oldOffscreen=global.OffscreenCanvas
  global.HTMLCanvasElement=class {};global.HTMLImageElement=class {}
  global.ImageBitmap=class {};global.OffscreenCanvas=class {}
  global.document={createElement:()=>({style:{}}),body:{appendChild(){},removeChild(){}},defaultView:{getComputedStyle:()=>({getPropertyValue:key=>key==='font-size'?'14px':'normal'})}}
  try {
    const s={...model.defaultSettings(metadata),sliceVisible:true,sliceMode:'multiple',region:{west:110,east:120,south:30,north:40}}
    collection.update(volume,s)
    assert.equal(alive.size,4)
    assert.equal(primitives.get(0).length,4)
    assert.equal(primitives.get(1).length,4, 'each geographic layer has a visible outline')
    const first=[...alive]
    collection.update(volume,{...s,sliceAltitudes:[100,200,300]})
    assert.equal(alive.size,3)
    assert.equal(removed.length,1)
    assert.ok([...alive].every(layer=>first.includes(layer)))
    collection.update(volume,{...s,sliceLabels:false})
    assert.equal(primitives.get(0).length,0)
    collection.clear()
    assert.equal(alive.size,0)
    collection.destroy()
    assert.equal(primitives.length,0)
  } finally {HeightSlice.prototype.update=oldUpdate;HeightSlice.prototype.destroy=oldDestroy;primitives.destroy();global.document=oldDocument;global.HTMLCanvasElement=oldCanvas;global.HTMLImageElement=oldImage;global.ImageBitmap=oldBitmap;global.OffscreenCanvas=oldOffscreen}
})
test('drawing two corners is transactional, rejects sky, and cancellation restores camera',async()=>{
  const path='../src/cesium/ionosphere/interaction/RegionDrawing.ts'
  assert.ok(fs.existsSync(require('node:path').resolve(__dirname,path)), 'region drawing exists')
  const C=await import('cesium'), actions=new Map(), keyboard=new EventTarget()
  const adapter={...C,ScreenSpaceEventHandler:class{setInputAction(fn,type){actions.set(type,fn)}destroy(){actions.clear()}}}
  const controller={enableInputs:true}, canvas={style:{cursor:''}}
  const viewer={canvas,scene:{screenSpaceCameraController:controller,globe:{ellipsoid:C.Ellipsoid.WGS84},requestRender(){}},camera:{pickEllipsoid:(p)=>p.sky?undefined:C.Cartesian3.fromDegrees(p.x,p.y)},entities:new C.EntityCollection(),isDestroyed:()=>false}
  const selected=[],states=[],hints=[]
  const {RegionDrawing}=require(path)
  const drawing=new RegionDrawing(adapter,viewer,{selected:r=>selected.push(r),active:v=>states.push(v),hint:v=>hints.push(v)},keyboard)
  drawing.start()
  assert.equal(controller.enableInputs,false)
  actions.get(C.ScreenSpaceEventType.LEFT_CLICK)({position:{sky:true}})
  assert.equal(selected.length,0)
  actions.get(C.ScreenSpaceEventType.LEFT_CLICK)({position:{x:110,y:30}})
  actions.get(C.ScreenSpaceEventType.MOUSE_MOVE)({endPosition:{x:120,y:40}})
  actions.get(C.ScreenSpaceEventType.LEFT_CLICK)({position:{x:120,y:40}})
  assert.equal(selected.length,1)
  for(const [key,value] of Object.entries({west:110,south:30,east:120,north:40})) assert.ok(Math.abs(selected[0][key]-value)<1e-10)
  assert.equal(controller.enableInputs,true)
  assert.equal(viewer.entities.values.length,0)
  drawing.start()
  const event=new Event('keydown');event.key='Escape';keyboard.dispatchEvent(event)
  assert.equal(drawing.active,false)
  assert.equal(controller.enableInputs,true)
  assert.equal(selected.length,1)
  controller.enableInputs=false
  drawing.start();drawing.destroy()
  assert.equal(controller.enableInputs,false)
  assert.equal(actions.size,0)
  assert.equal(viewer.entities.values.length,0)
})
