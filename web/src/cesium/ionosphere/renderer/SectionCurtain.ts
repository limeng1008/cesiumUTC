import type * as Cesium from 'cesium'
import type { VolumeSettings } from '../../../models/ionosphere/IonosphereVolume'
import type { SectionGrid, SectionSample } from '../../../models/ionosphere/Section'
import {
  createSectionRaster,
  sampleSectionGrid,
  sectionRasterAlpha,
} from '../../../utils/ionosphere/sections'
import { transfer } from '../shader/transferFunction'

/** A segmented geodetic curtain. Its own triangles provide picks, including on
 * bare sky, and share the scientific grid's endpoint UV parameterization. */
export class SectionCurtain {
  private primitive?: Cesium.Primitive
  private material?: Cesium.Material
  private outline?: Cesium.PolylineCollection
  private labels?: Cesium.LabelCollection
  private outlineMaterial?: Cesium.Material
  private grid?: SectionGrid
  private vertices: Cesium.Cartesian3[] = []
  private indices: number[] = []
  private key = ''
  private removeWarmup?: () => void
  constructor(private C: typeof Cesium, private viewer: Cesium.Viewer) {}

  update(grid: SectionGrid | null, settings: VolumeSettings): void {
    if (!grid) {
      this.destroy()
      return
    }
    const key = JSON.stringify([
      settings.valueRange,
      settings.colorMap,
      settings.normalization,
      settings.thresholdLow,
      settings.thresholdHigh,
      settings.opacity,
      settings.lowValueOpacity,
    ])
    if (this.grid === grid && this.key === key && this.primitive) return
    this.destroy()
    this.grid = grid
    this.key = key
    const C = this.C,
      canvas = document.createElement('canvas')
    canvas.width = grid.columns
    canvas.height = grid.rows
    const ctx = canvas.getContext('2d')!
    const pixels = ctx.createImageData(grid.columns, grid.rows)
    pixels.data.set(createSectionRaster(grid, settings))
    ctx.putImageData(pixels, 0, 0)
    const positions = new Array<number>(grid.columns * 2 * 3)
    const st = new Float32Array(grid.columns * 2 * 2)
    grid.positions.forEach((point, column) => {
      for (let row = 0; row < 2; row++) {
        const index = column * 2 + row
        const altitude = grid.altitudes[row === 0 ? 0 : grid.rows - 1]
        const position = C.Cartesian3.fromDegrees(point.longitude, point.latitude, altitude * 1000)
        this.vertices.push(position)
        C.Cartesian3.pack(position, positions, index * 3)
        // Texture coordinates address node texel centers. Mapping endpoints to
        // 0/1 would shift interior samples by half a cell under linear filtering.
        st[index * 2] = (column + 0.5) / grid.columns
        st[index * 2 + 1] = 1 - (0.5 + row * (grid.rows - 1)) / grid.rows
      }
      if (column < grid.columns - 1) {
        const a = column * 2
        this.indices.push(a, a + 2, a + 1, a + 2, a + 3, a + 1)
      }
    })
    const attributes = new C.GeometryAttributes()
    attributes.position = new C.GeometryAttribute({
      componentDatatype: C.ComponentDatatype.DOUBLE,
      componentsPerAttribute: 3,
      values: new Float64Array(positions),
    })
    attributes.st = new C.GeometryAttribute({
      componentDatatype: C.ComponentDatatype.FLOAT,
      componentsPerAttribute: 2,
      values: st,
    })
    const geometry = new C.Geometry({
      attributes,
      indices: new Uint16Array(this.indices),
      primitiveType: C.PrimitiveType.TRIANGLES,
      boundingSphere: C.BoundingSphere.fromVertices(positions),
    })
    C.GeometryPipeline.computeNormal(geometry)
    const material = C.Material.fromType('Image', {
      image: canvas,
      transparent: true,
      color: new C.Color(1, 1, 1, 0),
    })
    this.material = material
    this.primitive = this.viewer.scene.primitives.add(
      new C.Primitive({
        geometryInstances: new C.GeometryInstance({ geometry }),
        appearance: new C.MaterialAppearance({
          material,
          materialSupport: C.MaterialAppearance.MaterialSupport.TEXTURED,
          faceForward: true,
          translucent: true,
          flat: true,
          renderState: { depthTest: { enabled: true }, cull: { enabled: false } },
        }),
        asynchronous: false,
      })
    )
    this.outlineMaterial = C.Material.fromType('Color', {
      color: new C.Color(0.24, 0.68, 1, 0.5 * settings.opacity),
    })
    const outline = new C.PolylineCollection()
    this.outline = this.viewer.scene.primitives.add(outline)
    const top = this.vertices.filter((_, i) => i % 2 === 0)
    const bottom = this.vertices.filter((_, i) => i % 2 === 1).reverse()
    outline.add({
      positions: [...top, ...bottom, top[0]],
      width: 1.5,
      material: this.outlineMaterial,
    })
    const labels = new C.LabelCollection()
    this.labels = this.viewer.scene.primitives.add(labels)
    labels.show = settings.opacity > 0
    const annotation = (position: Cesium.Cartesian3, text: string) =>
      labels.add({
        position,
        text,
        font: '12px sans-serif',
        fillColor: C.Color.fromCssColorString('#c6e8ff'),
        showBackground: true,
        backgroundColor: C.Color.fromCssColorString('#071725cc'),
        pixelOffset: new C.Cartesian2(0, -12),
        horizontalOrigin: C.HorizontalOrigin.CENTER,
      })
    annotation(
      top[0],
      `${
        grid.kind === 'longitude' ? '南' : grid.kind === 'latitude' ? '西' : '起点'
      } · ${grid.altitudes[0].toFixed(0)} km`
    )
    annotation(bottom[bottom.length - 1], `${grid.altitudes[grid.rows - 1].toFixed(0)} km`)
    annotation(
      top[top.length - 1],
      grid.kind === 'longitude' ? '北' : grid.kind === 'latitude' ? '东' : '终点'
    )
    let frames = 0
    this.removeWarmup = this.viewer.scene.postRender.addEventListener(() => {
      if (++frames >= 2) {
        material.uniforms.color.alpha = 1
        this.removeWarmup?.()
        this.removeWarmup = undefined
      }
      this.viewer.scene.requestRender()
    })
    this.viewer.scene.requestRender()
  }

  pick(screenPosition: { x: number; y: number }, settings: VolumeSettings): SectionSample | null {
    if (!this.grid || !this.primitive?.show || !settings.section.visible || settings.opacity <= 0)
      return null
    const C = this.C,
      ray = this.viewer.camera.getPickRay(new C.Cartesian2(screenPosition.x, screenPosition.y))
    if (!ray) return null
    const earth = C.IntersectionTests.rayEllipsoid(ray, C.Ellipsoid.WGS84)
    const earthDistance = earth && earth.stop > 0 ? Math.max(0, earth.start) : Infinity
    let nearest = earthDistance,
      result: SectionSample | null = null
    for (let i = 0; i < this.indices.length; i += 3) {
      const ia = this.indices[i],
        ib = this.indices[i + 1],
        ic = this.indices[i + 2]
      const a = this.vertices[ia],
        b = this.vertices[ib],
        c = this.vertices[ic]
      const distance = C.IntersectionTests.rayTriangleParametric(ray, a, b, c, false)
      if (distance === undefined || distance < 0 || distance >= nearest) continue
      const point = C.Ray.getPoint(ray, distance, new C.Cartesian3())
      const weights = C.barycentricCoordinates(point, a, b, c, new C.Cartesian3())
      if (!weights) continue
      const u =
        (Math.floor(ia / 2) * weights.x +
          Math.floor(ib / 2) * weights.y +
          Math.floor(ic / 2) * weights.z) /
        (this.grid.columns - 1)
      const v = (ia % 2) * weights.x + (ib % 2) * weights.y + (ic % 2) * weights.z
      const sample = sampleSectionGrid(
        this.grid,
        Math.max(0, Math.min(1, u)),
        Math.max(0, Math.min(1, v)),
        settings.interpolation
      )
      if (
        !sample ||
        transfer(sample.value, settings)[3] <= 0 ||
        sectionRasterAlpha(this.grid, settings, sample.sectionU, sample.sectionV) <= 0
      )
        continue
      nearest = distance
      result = sample
    }
    return result
  }

  destroy(): void {
    this.removeWarmup?.()
    this.removeWarmup = undefined
    if (this.primitive && !this.viewer.isDestroyed())
      this.viewer.scene.primitives.remove(this.primitive)
    this.primitive = undefined
    // Primitive does not own appearance materials or their image textures.
    if (this.material && !this.material.isDestroyed()) this.material.destroy()
    this.material = undefined
    if (this.outline && !this.viewer.isDestroyed())
      this.viewer.scene.primitives.remove(this.outline)
    this.outline = undefined
    if (this.outlineMaterial && !this.outlineMaterial.isDestroyed()) this.outlineMaterial.destroy()
    this.outlineMaterial = undefined
    if (this.labels && !this.viewer.isDestroyed()) this.viewer.scene.primitives.remove(this.labels)
    this.labels = undefined
    this.grid = undefined
    this.vertices = []
    this.indices = []
    this.key = ''
  }
}
