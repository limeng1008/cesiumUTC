import type * as Cesium from 'cesium'
import type { IonosphereVolume, VolumeSettings } from '../../../models/ionosphere/IonosphereVolume'
import { longitudeSpan, type GeographicRegion } from '../../../utils/ionosphere/region'
import { regionalPresentation } from './regionalPresentation'

function ring(C: typeof Cesium, region: GeographicRegion, height: number): Cesium.Cartesian3[] {
  const points: number[] = [],
    east = region.west + longitudeSpan(region)
  const corners = [
    [region.west, region.south],
    [east, region.south],
    [east, region.north],
    [region.west, region.north],
  ]
  for (let side = 0; side < 4; side++) {
    const a = corners[side],
      b = corners[(side + 1) % 4]
    for (let i = 0; i < 32; i++)
      points.push(a[0] + ((b[0] - a[0]) * i) / 32, a[1] + ((b[1] - a[1]) * i) / 32, height * 1000)
  }
  points.push(region.west, region.south, height * 1000)
  return C.Cartesian3.fromDegreesArrayHeights(points)
}
export function makeEnvelopeGeometry(
  C: typeof Cesium,
  region: GeographicRegion,
  min: number,
  max: number
) {
  const fill = C.ColorGeometryInstanceAttribute.fromColor(new C.Color(0.25, 0.6, 0.9, 0.025))
  const edge = C.ColorGeometryInstanceAttribute.fromColor(new C.Color(0.48, 0.78, 1, 0.62))
  const rectangle = C.Rectangle.fromDegrees(region.west, region.south, region.east, region.north)
  const faces = [min, max].map(
    (h) =>
      new C.GeometryInstance({
        geometry: new C.RectangleGeometry({
          rectangle,
          height: h * 1000,
          granularity: C.Math.toRadians(0.2),
          vertexFormat: C.PerInstanceColorAppearance.FLAT_VERTEX_FORMAT,
        }),
        attributes: { color: fill },
      })
  )
  const edges = [min, max].map(
    (h) =>
      new C.GeometryInstance({
        geometry: new C.PolylineGeometry({
          positions: ring(C, region, h),
          width: 1.3,
          vertexFormat: C.PolylineColorAppearance.VERTEX_FORMAT,
        }),
        attributes: { color: edge },
      })
  )
  const lower = ring(C, region, min)
  for (let side = 0; side < 4; side++) {
    const positions = lower.slice(side * 32, side * 32 + 33)
    faces.push(
      new C.GeometryInstance({
        geometry: new C.WallGeometry({
          positions,
          minimumHeights: positions.map(() => min * 1000),
          maximumHeights: positions.map(() => max * 1000),
          vertexFormat: C.PerInstanceColorAppearance.FLAT_VERTEX_FORMAT,
        }),
        attributes: { color: fill },
      })
    )
    const corner = C.Cartographic.fromCartesian(lower[side * 32])
    edges.push(
      new C.GeometryInstance({
        geometry: new C.PolylineGeometry({
          positions: [min, max].map((h) =>
            C.Cartesian3.fromRadians(corner.longitude, corner.latitude, h * 1000)
          ),
          width: 1.3,
          vertexFormat: C.PolylineColorAppearance.VERTEX_FORMAT,
        }),
        attributes: { color: edge },
      })
    )
  }
  return { faces, edges }
}

interface ProvinceFeature {
  properties: { adcode: number }
  geometry: { type: string; coordinates: number[][][][] }
}
/** Few batched Primitives: province boundary, envelope faces, edges and reference labels. */
export class RegionalContext {
  private envelope: Cesium.PrimitiveCollection
  private map: Cesium.PrimitiveCollection
  private request?: AbortController
  private imagery?: Cesium.ImageryLayer
  private generation = 0
  private key = ''
  private credit: Cesium.Credit
  private previousSkybox?: boolean
  private sceneMode?: boolean
  constructor(
    private C: typeof Cesium,
    private viewer: Cesium.Viewer,
    private error: (message: string) => void
  ) {
    this.envelope = viewer.scene.primitives.add(new C.PrimitiveCollection())
    this.map = viewer.scene.primitives.add(new C.PrimitiveCollection())
    this.credit = new C.Credit(
      '<a href="https://datav.aliyun.com/portal/school/atlas/area_selector" target="_blank" rel="noopener">山东边界 · 阿里云 DataV（示意）</a>'
    )
  }
  private async load(province: boolean): Promise<void> {
    if (this.viewer.scene.skyBox) {
      this.previousSkybox = this.viewer.scene.skyBox.show
      this.viewer.scene.skyBox.show = false
    }
    const generation = ++this.generation,
      abort = new AbortController()
    this.request?.abort()
    this.request = abort
    if (province)
      try {
        const response = await fetch('/data/shandong-boundary.geojson', { signal: abort.signal })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = (await response.json()) as { features: ProvinceFeature[] }
        if (generation !== this.generation || this.viewer.isDestroyed()) return
        const feature = data.features.find((f) => f.properties.adcode === 370000)
        if (!feature || feature.geometry.type !== 'MultiPolygon')
          throw new Error('山东省边界格式异常')
        const C = this.C,
          instances: Cesium.GeometryInstance[] = []
        for (const polygon of feature.geometry.coordinates)
          for (const coordinates of polygon) {
            if (coordinates.length < 3) continue
            const points = coordinates.flatMap((p) => [p[0], p[1], 1200])
            instances.push(
              new C.GeometryInstance({
                geometry: new C.PolylineGeometry({
                  positions: C.Cartesian3.fromDegreesArrayHeights(points),
                  width: 2.5,
                  vertexFormat: C.PolylineColorAppearance.VERTEX_FORMAT,
                }),
                attributes: {
                  color: C.ColorGeometryInstanceAttribute.fromColor(
                    new C.Color(0.43, 0.85, 1, 0.98)
                  ),
                },
              })
            )
          }
        this.map.add(
          new C.Primitive({
            geometryInstances: instances,
            appearance: new C.PolylineColorAppearance({ translucent: true }),
            asynchronous: false,
          })
        )
        const labels = this.map.add(new C.LabelCollection()) as Cesium.LabelCollection
        for (const city of [
          { name: '济南', lon: 117.12, lat: 36.65 },
          { name: '青岛', lon: 120.38, lat: 36.07 },
          { name: '山 东 省', lon: 116.6, lat: 35.6 },
        ])
          labels.add({
            position: C.Cartesian3.fromDegrees(city.lon, city.lat, 1500),
            text: city.name,
            font: city.name === '山 东 省' ? '20px sans-serif' : '13px sans-serif',
            fillColor: C.Color.WHITE,
            style: C.LabelStyle.FILL_AND_OUTLINE,
            outlineColor: C.Color.fromCssColorString('#082035'),
            outlineWidth: 3,
          })
        this.viewer.creditDisplay.addStaticCredit(this.credit)
        this.viewer.scene.requestRender()
      } catch (error) {
        if (!abort.signal.aborted && generation === this.generation)
          this.error(`山东边界加载失败：${String(error)}`)
      }
    // Detailed public imagery is optional. Local Natural Earth remains the offline fallback.
    if (generation !== this.generation || this.viewer.isDestroyed()) return
    try {
      const provider = await this.C.ArcGisMapServerImageryProvider.fromUrl(
        'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer'
      )
      if (generation !== this.generation || this.viewer.isDestroyed()) return
      this.imagery = this.viewer.imageryLayers.addImageryProvider(provider)
      this.imagery.brightness = 0.5
      this.imagery.saturation = 0.75
      this.viewer.scene.requestRender()
    } catch {
      /* Offline fallback is already visible and attributed by GlobeScene. */
    }
  }
  update(volume: IonosphereVolume, settings: VolumeSettings): void {
    const presentation = regionalPresentation(volume.metadata, settings)
    if (!presentation) {
      if (this.sceneMode !== undefined) this.clear()
      return
    }
    const { region, heights, province } = presentation
    if (this.sceneMode !== province) {
      this.clear()
      this.sceneMode = province
      void this.load(province)
    }
    const key = JSON.stringify([region, heights])
    if (key === this.key) return
    this.key = key
    this.envelope.removeAll()
    const C = this.C,
      geometry = makeEnvelopeGeometry(C, region, ...heights)
    this.envelope.add(
      new C.Primitive({
        geometryInstances: geometry.faces,
        appearance: new C.PerInstanceColorAppearance({
          flat: true,
          translucent: true,
          closed: false,
        }),
        asynchronous: false,
      })
    )
    this.envelope.add(
      new C.Primitive({
        geometryInstances: geometry.edges,
        appearance: new C.PolylineColorAppearance({ translucent: true }),
        asynchronous: false,
      })
    )
  }
  clear(): void {
    this.sceneMode = undefined
    this.generation++
    this.request?.abort()
    this.request = undefined
    this.key = ''
    this.envelope.removeAll()
    this.map.removeAll()
    if (!this.viewer.isDestroyed()) {
      if (this.viewer.scene.skyBox && this.previousSkybox !== undefined)
        this.viewer.scene.skyBox.show = this.previousSkybox
      if (this.imagery) this.viewer.imageryLayers.remove(this.imagery)
      this.viewer.creditDisplay.removeStaticCredit(this.credit)
    }
    this.imagery = undefined
    this.previousSkybox = undefined
  }
  destroy(): void {
    this.clear()
    if (!this.viewer.isDestroyed()) {
      this.viewer.scene.primitives.remove(this.envelope)
      this.viewer.scene.primitives.remove(this.map)
    }
  }
}
