const ts = require('typescript')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { test } = require('node:test')
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, file)
const model = require('../src/models/ionosphere/IonosphereVolume.ts')
const axis = (min, max, count) => ({ min, max, count, step: (max - min) / count })
const metadata = { longitude: axis(0, 4, 4), latitude: axis(0, 4, 4), altitude: axis(100, 500, 4), minValue: 1, maxValue: 1000, id: 'section-test' }
const volume = { metadata, values: Float32Array.from({length: 64}, (_,i) => 10 * (i % 4 + .5) + 20 * (Math.floor(i / 4) % 4 + .5) + (150 + Math.floor(i / 16) * 100)) }
const settings = { ...model.defaultSettings(metadata), section:{kind:'latitude',longitude:1,latitude:1,path:null,visible:true}, altitudeRange: [150, 450], interpolation: 'trilinear', valueRange: [1,1000] }
function sections() {
  const file = path.resolve(__dirname, '../src/utils/ionosphere/sections.ts')
  assert.ok(fs.existsSync(file), 'section sampling module exists')
  return require(file)
}
test('section node grid reproduces affine field, top-down orientation and end coordinates', () => {
  const {createSectionGrid, sampleSectionGrid} = sections()
  const grid = createSectionGrid(volume, settings, [{longitude:.5,latitude:1}, {longitude:3.5,latitude:1}], [0, 300], 'latitude', 3)
  assert.deepEqual(grid.altitudes, [450,300,150])
  assert.deepEqual(Array.from(grid.values), [475,505,325,355,175,205])
  const sample = sampleSectionGrid(grid,.5,.25)
  assert.equal(sample.value,415)
  assert.equal(sample.longitude,2)
  assert.equal(sample.altitude,375)
  assert.equal(sample.distance,150)
  assert.equal(sample.source,'vertical-section')
  assert.equal(sampleSectionGrid(grid,0,0).value,475)
  assert.equal(sampleSectionGrid(grid,1,1).value,205)
  assert.equal(sampleSectionGrid(grid,-.1,.5),null)
  assert.equal(sampleSectionGrid(grid,.5,NaN),null)
})
test('section grid preserves missing cells, region and valid domain masks', () => {
  const {createSectionGrid,sampleSectionGrid,createSectionRaster} = sections()
  const s = {...settings,region:{west:0,east:2,south:0,north:4}}
  const grid = createSectionGrid(volume,s,[{longitude:1,latitude:1},{longitude:3,latitude:1}],[0,200],'latitude',2)
  assert.ok(Number.isNaN(grid.values[1]))
  assert.equal(sampleSectionGrid(grid,.5,.5),null)
  assert.ok(sampleSectionGrid(grid,0,0))
  const pixels=createSectionRaster(grid,s)
  assert.equal(pixels[7],0)
  assert.ok(pixels[3]>0)
  assert.ok(createSectionRaster(grid,{...s,opacity:0}).every((v,i)=>i%4!==3||v===0))
  const missing={...volume,metadata:{...metadata,noDataValue:volume.values[0]}}
  assert.ok(Number.isNaN(createSectionGrid(missing,settings,[{longitude:.5,latitude:.5},{longitude:1.5,latitude:.5}],[0,100],'latitude',2).values[2]))
  const domain={...volume,metadata:{...metadata,validDomain:{latitudeMin:2,latitudeMax:4,altitudeMin:200,altitudeMax:400}}}
  const masked=createSectionGrid(domain,settings,[{longitude:1,latitude:1},{longitude:1,latitude:3}],[0,100],'longitude',3)
  assert.deepEqual(masked.altitudes,[400,300,200])
  assert.ok(Number.isNaN(masked.values[0]))
  assert.ok(Number.isFinite(masked.values[1]))
})
test('section longitude interpolation crosses the dateline and allocations are bounded',()=>{
  const {createSectionGrid,sampleSectionGrid}=sections()
  const global={metadata:{...metadata,longitude:axis(-180,180,4)},values:new Float32Array(64).fill(10)}
  const grid=createSectionGrid(global,settings,[{longitude:179,latitude:1},{longitude:-179,latitude:1}],[0,200],'path',2)
  assert.equal(sampleSectionGrid(grid,.5,.5).longitude,-180)
  const positions=Array.from({length:2000},(_,i)=>({longitude:i/1000,latitude:1}))
  const capped=createSectionGrid(volume,settings,positions,positions.map((_,i)=>i),'latitude',1000000)
  assert.ok(capped.columns<=513&&capped.rows<=512)
  assert.deepEqual(capped.positions.at(-1),positions.at(-1))
  assert.equal(createSectionGrid(volume,settings,[],[],'path'),null)
})
test('WGS84 section paths preserve requested direction and shortest dateline geodesic',async()=>{
  const file=path.resolve(__dirname,'../src/cesium/ionosphere/renderer/sectionPath.ts')
  assert.ok(fs.existsSync(file),'section path adapter exists')
  const {createSectionPath}=require(file), C=await import('cesium')
  const region={west:170,east:-170,south:-10,north:10}, d={kind:'latitude',latitude:5,longitude:175,path:null,visible:true}
  const lat=createSectionPath(C,d,region,5)
  assert.deepEqual(lat.positions.map(p=>p.longitude),[170,175,-180,-175,-170])
  assert.ok(lat.positions.every(p=>p.latitude===5))
  assert.ok(lat.distances[4]>2000&&lat.distances[4]<2300)
  const lon=createSectionPath(C,{...d,kind:'longitude'},region,3)
  assert.deepEqual(lon.positions.map(p=>p.latitude),[-10,0,10])
  const route=createSectionPath(C,{...d,kind:'path',path:[{longitude:179,latitude:0},{longitude:-179,latitude:0}]},region,3)
  assert.ok(Math.abs(Math.abs(route.positions[1].longitude)-180)<1e-8)
  assert.ok(Math.abs(route.distances[2]-222.63898)<.001)
  assert.equal(createSectionPath(C,{...d,kind:'path',path:[{longitude:1,latitude:1},{longitude:1,latitude:1}]},region),null)
  assert.equal(createSectionPath(C,{...d,kind:'path',path:[{longitude:0,latitude:0},{longitude:180,latitude:0}]},region),null)
})
test('curtain picks its triangles with matching UV, ignores transparent cells and releases resources',async()=>{
  const file=path.resolve(__dirname,'../src/cesium/ionosphere/renderer/SectionCurtain.ts')
  assert.ok(fs.existsSync(file),'section curtain exists')
  const {SectionCurtain}=require(file), C=await import('cesium')
  const {createSectionGrid}=sections()
  const materials=[]
  const adapter={...C,Material:{fromType:(_name,uniforms)=>{const m={uniforms,dead:false,isDestroyed(){return this.dead},destroy(){this.dead=true}};materials.push(m);return m}}}
  const oldDocument=global.document
  global.document={body:{appendChild(){},removeChild(){}},defaultView:{getComputedStyle:()=>({getPropertyValue:p=>p==='font-size'?'12px':'normal'})},createElement:()=>({style:{},getContext:()=>({createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){}})})}
  const primitives=new C.PrimitiveCollection(),postRender=new C.Event()
  let ray
  const viewer={scene:{primitives,postRender,requestRender(){}},camera:{getPickRay:()=>ray},isDestroyed:()=>false}
  try {
    const curtain=new SectionCurtain(adapter,viewer)
    const grid=createSectionGrid(volume,settings,[{longitude:1,latitude:1},{longitude:3,latitude:1}],[0,200],'latitude',3)
    curtain.update(grid,settings)
    assert.equal(primitives.length,3,'curtain, perimeter and annotations are present')
    assert.match(primitives.get(2).get(0).text,/450.*km/)
    assert.equal(primitives.get(1).length,1,'one continuous perimeter, without per-cell entities')
    assert.equal(postRender.numberOfListeners,1)
    const geometry=primitives.get(0).geometryInstances.geometry
    const st=geometry.attributes.st.values
    assert.ok(Math.abs(st[0]-.5/grid.columns)<1e-7,'left node maps to first texel center')
    assert.ok(Math.abs(st[1]-(1-.5/grid.rows))<1e-7,'top node maps to top texel center')
    const a=C.Cartesian3.fromDegrees(1,1,450000), b=C.Cartesian3.fromDegrees(3,1,450000), c=C.Cartesian3.fromDegrees(1,1,150000)
    const target=C.Cartesian3.add(C.Cartesian3.multiplyByScalar(a,.25,new C.Cartesian3()),C.Cartesian3.multiplyByScalar(b,.5,new C.Cartesian3()),new C.Cartesian3())
    C.Cartesian3.add(target,C.Cartesian3.multiplyByScalar(c,.25,new C.Cartesian3()),target)
    const normal=C.Cartesian3.normalize(C.Cartesian3.cross(C.Cartesian3.subtract(b,a,new C.Cartesian3()),C.Cartesian3.subtract(c,a,new C.Cartesian3()),new C.Cartesian3()),new C.Cartesian3())
    const origin=C.Cartesian3.add(target,C.Cartesian3.multiplyByScalar(normal,100000,new C.Cartesian3()),new C.Cartesian3())
    ray=new C.Ray(origin,C.Cartesian3.negate(normal,new C.Cartesian3()))
    const picked=curtain.pick(new C.Cartesian2(),settings)
    assert.ok(picked)
    assert.ok(Math.abs(picked.sectionU-.5)<1e-8)
    assert.ok(Math.abs(picked.sectionV-.25)<1e-8)
    const saved=grid.values.slice()
    grid.values.set([10,1000,10,1000,10,1000])
    const invisible={...settings,valueRange:[400,600]}
    curtain.update(grid,invisible)
    assert.equal(curtain.pick(new C.Cartesian2(),invisible),null,'transparent texture neighbors cannot create a hittable midpoint')
    grid.values.set(saved)
    curtain.update(grid,settings)
    assert.equal(curtain.pick(new C.Cartesian2(),{...settings,opacity:0}),null)
    assert.equal(curtain.pick(new C.Cartesian2(),{...settings,section:{...settings.section,visible:false}}),null)
    postRender.raiseEvent();postRender.raiseEvent()
    assert.equal(curtain.material.uniforms.color.alpha,1)
    assert.equal(postRender.numberOfListeners,0)
    curtain.update(grid,{...settings,colorMap:'viridis'})
    assert.equal(materials[0].dead,true)
    curtain.destroy();curtain.destroy()
    assert.equal(primitives.length,0)
    assert.equal(postRender.numberOfListeners,0)
    assert.ok(materials.every(m=>m.dead))
  } finally {global.document=oldDocument;primitives.destroy()}
})
