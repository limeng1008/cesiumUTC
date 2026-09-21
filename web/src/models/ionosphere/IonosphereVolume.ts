import {
  sanitizeRegion,
  displayRegion,
  longitudeSpan,
  containsRegion,
  type GeographicRegion,
} from '../../utils/ionosphere/region'
import { sanitizeSliceHeights } from '../../utils/ionosphere/slices'
import type { SectionDefinition } from './Section'
import { isTemperature, type ScalarParameter } from '../../utils/ionosphere/parameters'
/** Bounds are cell edges; samples are at min + (index + 0.5) * step. */
export interface IonosphereAxis {
  min: number
  max: number
  count: number
  step: number
}
export interface IonosphereVolumeMetadata {
  parameter: ScalarParameter
  parameterName: string
  unit: 'm^-3' | 'K'
  sourceVariable?: string
  sourceUnit?: string
  species?: string
  defaultNormalization?: 'linear' | 'log'
  longitude: IonosphereAxis
  latitude: IonosphereAxis
  altitude: IonosphereAxis
  minValue: number
  maxValue: number
  noDataValue?: number
  sampling: 'cell-center'
  altitudeUnit: 'km'
  order: 'zyx'
  dtype: 'float32'
  byteOrder: 'little'
  source: string
  sourceName?: string
  timestamp?: string
  sourceFile?: string
  sourceSha256?: string
  sourceUrl?: string
  validDomain?: {
    latitudeMin: number
    latitudeMax: number
    altitudeMin: number
    altitudeMax: number
  }
  id: string
  byteLength: number
}
export interface IonosphereVolume {
  metadata: IonosphereVolumeMetadata
  /** X=longitude (fastest), Y=latitude, Z=altitude: index=z*ny*nx+y*nx+x. */
  values: Float32Array
}
export type VolumeSource = 'mock' | 'sami3' | 'shandong-mock'
export interface VolumeSourceCatalog {
  defaultSource: VolumeSource
  sources: Array<{ id: VolumeSource; name: string; available: boolean }>
}
export type IonosphereDisplayMode =
  | 'volume'
  | 'height-slice'
  | 'multi-height-slice'
  | 'isosurface'
  | 'latitude-section'
  | 'longitude-section'
  | 'path-section'
export type NormalizationMode = 'linear' | 'log'
export type ColorMap = 'scientific' | 'viridis' | 'blue-red'
export type Quality = 'performance' | 'standard' | 'high'
export type InterpolationMode = 'nearest' | 'trilinear'
export interface SamplePosition {
  longitude: number
  latitude: number
  altitude: number
}
export interface IonosphereSample extends SamplePosition {
  value: number | null
  method: InterpolationMode
  source: 'voxel-ray' | 'height-slice' | 'coordinate' | 'vertical-section'
  sectionU?: number
  sectionV?: number
  distance?: number
  voxelIndex?: number
}
export interface VolumeSettings {
  rangeMode: 'global' | 'region' | 'manual'
  section: SectionDefinition
  altitudeRange: [number, number]
  valueRange: [number, number]
  opacity: number
  lowValueOpacity: number
  thresholdLow: number
  thresholdHigh: number
  quality: Quality
  normalization: NormalizationMode
  colorMap: ColorMap
  displayMode: IonosphereDisplayMode
  sliceAltitude: number
  sliceMode: 'single' | 'multiple'
  sliceAltitudes: number[]
  sliceLabels: boolean
  region: GeographicRegion | null
  volumeVisible: boolean
  sliceVisible: boolean
  probeEnabled: boolean
  interpolation: InterpolationMode
}
export function defaultSettings(metadata?: IonosphereVolumeMetadata | null): VolumeSettings {
  const regional = metadata?.source === 'shandong-mock'
  const altitudeMin = metadata?.validDomain?.altitudeMin ?? metadata?.altitude.min ?? 80,
    altitudeMax = metadata?.validDomain?.altitudeMax ?? metadata?.altitude.max ?? 1000
  return {
    rangeMode: 'global',
    section: { kind: 'longitude', longitude: 118, latitude: 37.25, path: null, visible: false },
    altitudeRange: [altitudeMin, altitudeMax],
    valueRange: metadata ? [metadata.minValue, metadata.maxValue] : [1e8, 1e12],
    opacity: regional ? 0.45 : 0.65,
    lowValueOpacity: regional ? 0.56 : 0.08,
    thresholdLow: 0,
    thresholdHigh: 1,
    quality: 'standard',
    normalization: regional || isTemperature(metadata?.parameter) ? 'linear' : 'log',
    colorMap: 'blue-red',
    displayMode: regional ? 'multi-height-slice' : 'volume',
    sliceAltitude: Math.max(altitudeMin, Math.min(altitudeMax, 300)),
    sliceMode: regional ? 'multiple' : 'single',
    sliceAltitudes: sanitizeSliceHeights([100, 200, 300, 400], altitudeMin, altitudeMax),
    sliceLabels: true,
    region: regional ? { west: 114, east: 122, south: 34, north: 40.5 } : null,
    volumeVisible: !regional,
    sliceVisible: !!regional,
    probeEnabled: !!regional,
    interpolation: 'trilinear',
  }
}
/** Validate numeric UI drafts before they reach GPU uniforms. Preserve valid
 * values exactly (in particular the metadata extrema, without display rounding).
 */
export function sanitizeSettings(
  settings: VolumeSettings,
  metadata?: IonosphereVolumeMetadata | null
): VolumeSettings {
  const s = structuredClone(settings),
    d = defaultSettings(metadata)
  s.rangeMode = ['global', 'region', 'manual'].includes(s.rangeMode) ? s.rangeMode : 'global'
  const finite = (value: number, fallback: number) => (Number.isFinite(value) ? value : fallback)
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
  const [altitudeMin, altitudeMax] = d.altitudeRange,
    separation = Math.min(1, (altitudeMax - altitudeMin) / 2)
  s.altitudeRange[0] = clamp(
    finite(s.altitudeRange[0], altitudeMin),
    altitudeMin,
    altitudeMax - separation
  )
  s.altitudeRange[1] = clamp(
    finite(s.altitudeRange[1], altitudeMax),
    s.altitudeRange[0] + separation,
    altitudeMax
  )
  s.valueRange[0] = clamp(
    finite(s.valueRange[0], d.valueRange[0]),
    s.normalization === 'log' ? 1e-30 : 0,
    1e30 / (1 + 1e-6)
  )
  const upperValue = Math.min(finite(s.valueRange[1], d.valueRange[1]), 1e30)
  s.valueRange[1] =
    upperValue > s.valueRange[0]
      ? upperValue
      : s.valueRange[0] + Math.max(1e-30, s.valueRange[0] * 1e-6)
  s.sliceAltitude = clamp(finite(s.sliceAltitude, d.sliceAltitude), altitudeMin, altitudeMax)
  s.opacity = clamp(finite(s.opacity, d.opacity), 0, 1)
  s.lowValueOpacity = clamp(finite(s.lowValueOpacity, d.lowValueOpacity), 0, 1)
  s.sliceMode = s.sliceMode === 'multiple' ? 'multiple' : 'single'
  s.sliceAltitudes = sanitizeSliceHeights(
    s.sliceAltitudes ?? d.sliceAltitudes,
    altitudeMin,
    altitudeMax
  )
  s.sliceLabels = typeof s.sliceLabels === 'boolean' ? s.sliceLabels : d.sliceLabels
  s.region = sanitizeRegion(s.region)
  const section = s.section ?? d.section
  s.section = {
    kind: ['longitude', 'latitude', 'path'].includes(section.kind) ? section.kind : 'longitude',
    longitude: clamp(finite(section.longitude, 118), -180, 180),
    latitude: clamp(finite(section.latitude, 37.25), -90, 90),
    visible: section.visible === true,
    path:
      Array.isArray(section.path) &&
      section.path.length === 2 &&
      section.path.every(
        (p) =>
          Number.isFinite(p.longitude) &&
          Number.isFinite(p.latitude) &&
          p.longitude >= -180 &&
          p.longitude <= 180 &&
          p.latitude >= -90 &&
          p.latitude <= 90
      )
        ? section.path
        : null,
  }
  const sectionRegion =
    metadata?.longitude && metadata?.latitude ? displayRegion(s.region, metadata) : s.region
  if (sectionRegion) {
    const r = sectionRegion
    s.section.latitude = clamp(s.section.latitude, r.south, r.north)
    if (!containsRegion(r, s.section.longitude, (r.south + r.north) / 2))
      s.section.longitude = ((((r.west + longitudeSpan(r) / 2 + 180) % 360) + 360) % 360) - 180
  }
  s.thresholdLow = clamp(finite(s.thresholdLow, d.thresholdLow), 0, 0.99)
  s.thresholdHigh = clamp(finite(s.thresholdHigh, d.thresholdHigh), s.thresholdLow + 0.01, 1)
  return s
}
