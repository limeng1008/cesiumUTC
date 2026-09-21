import type { IonosphereAxis, IonosphereVolumeMetadata } from './IonosphereVolume'
import type { DerivedQuality, QualityCounts } from './Derived'
export interface OverviewFrame {
  datasetId: string
  timeIndex: number
  metadata: IonosphereVolumeMetadata
  values: number[]
}
export interface F2Peak {
  nmF2: number
  hmF2: number
  foF2: number
  boundary: boolean
}
export interface ProfileMetrics {
  tec: number | null
  peak: F2Peak | null
  contentQuality: DerivedQuality
  f2Quality: DerivedQuality
  coverage: number
}
export interface OverviewProfile extends ProfileMetrics {
  longitude: number
  latitude: number
  altitudes: number[]
  values: (number | null)[]
}
export interface TecGrid {
  longitude: IonosphereAxis
  latitude: IonosphereAxis
  values: (number | null)[]
  range: [number, number] | null
}
export interface OverviewAnalysis extends TecGrid {
  meanTec: number | null
  validColumns: number
  eligibleColumns: number
  validF2Columns: number
  qualityCounts: { content: QualityCounts; f2: QualityCounts }
  peak: (F2Peak & { longitude: number; latitude: number }) | null
  altitudeRange: [number, number]
}
export interface WeatherInfo {
  available: boolean
  kp: number | null
  intervalStart: string | null
  intervalEnd: string | null
  level: string | null
  label: string
  source: string
  sourceUrl: string
  reason: string | null
}
export interface OverviewTrend {
  index: number
  timestamp: string
  meanTec: number | null
}
