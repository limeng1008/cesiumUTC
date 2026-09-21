import type { IonosphereSample } from './IonosphereVolume'

export interface GeoPoint {
  longitude: number
  latitude: number
}
export type SectionKind = 'longitude' | 'latitude' | 'path'
export interface SectionDefinition {
  kind: SectionKind
  longitude: number
  latitude: number
  path: [GeoPoint, GeoPoint] | null
  visible: boolean
}
/** Samples include both endpoints. Rows run from the highest to lowest altitude;
 * index = row * columns + column. Missing samples are NaN, never zero density. */
export interface SectionGrid {
  kind: SectionKind
  columns: number
  rows: number
  positions: GeoPoint[]
  /** Cumulative WGS84 surface distance in km, one value per column. */
  distances: number[]
  /** Altitudes in km, one value per row, top to bottom. */
  altitudes: number[]
  values: Float32Array
}
export interface SectionSample extends Omit<IonosphereSample, 'source'> {
  source: 'vertical-section'
  sectionU: number
  /** 0 is the highest altitude, 1 is the lowest altitude. */
  sectionV: number
  distance: number
}
