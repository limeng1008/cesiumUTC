import type {
  IonosphereVolume,
  IonosphereSample,
  SamplePosition,
  VolumeSettings,
  Quality,
} from '../../../models/ionosphere/IonosphereVolume'
import type { GeographicRegion } from '../../../utils/ionosphere/region'
import type { SectionGrid, GeoPoint } from '../../../models/ionosphere/Section'
export interface RendererDiagnostics {
  ready: boolean
  renderer: string
  stepSize: number
  screenSpaceError: number
  gpuBytesEstimate: number
  fps: number | null
  renderMs: number | null
}
export interface RendererEvents {
  section?: (grid: SectionGrid | null) => void
  sectionSelected?: (path: [GeoPoint, GeoPoint]) => void
  sectionDrawing?: (active: boolean) => void
  sectionHint?: (hint: string) => void
  ready: () => void
  error: (message: string) => void
  sample: (point: IonosphereSample | null) => void
  diagnostics: (data: RendererDiagnostics) => void
  regionSelected?: (region: GeographicRegion) => void
  regionDrawing?: (active: boolean) => void
  regionHint?: (message: string) => void
}
/** No Cesium types may leak across this boundary into scientific data/state/UI. */
export interface IonosphereVolumeRenderer {
  clear(): void
  load(volume: IonosphereVolume): void
  configure(settings: VolumeSettings): void
  beginRegionSelection(): void
  beginSectionSelection?(): void
  cancelSectionSelection?(): void
  markSample?(point: IonosphereSample | null): void
  cancelRegionSelection(): void
  focusRegion(): void
  setAltitudeRange(min: number, max: number): void
  setValueRange(min: number, max: number): void
  setOpacity(opacity: number): void
  setQuality(quality: Quality): void
  pick(position: { x: number; y: number }): IonosphereSample | null
  sample(position: SamplePosition): IonosphereSample | null
  destroy(): void
}
