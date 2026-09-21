import type { IonosphereAxis } from './IonosphereVolume'

export const DERIVED_ALGORITHM = 'ne-derived-v1'
export const DEFAULT_F2_WINDOW: readonly [number, number] = [200, 600]
export const PEAK_RELATIVE_TOLERANCE = 1e-6
export const DERIVED_QUALITY_LABELS = {
  valid: '有效',
  'invalid-input': '输入或高度范围无效',
  'outside-coverage': '请求范围超出有效高度覆盖',
  'missing-data': '区间内存在缺测',
  'no-positive-peak': '无正电子密度峰',
  'ambiguous-peak': '并列最大值或平顶，无法区分唯一峰',
  'boundary-peak': '最大值位于搜索窗边界，无可靠内部峰',
} as const
export type DerivedQuality = keyof typeof DERIVED_QUALITY_LABELS
export type Quality = DerivedQuality
export type HeightRange = readonly [number, number]
export const DERIVED_METRICS = {
  content: {
    label: '区间电子含量',
    unit: 'TECU',
    description: '指定高度区间的 Ne 积分；不代表完整顶部 VTEC 或 GNSS STEC。',
  },
  nmF2: {
    label: 'NmF2',
    unit: 'm⁻³',
    description: '完整 F2 搜索窗内唯一、严格内部的正电子密度峰值。',
  },
  hmF2: {
    label: 'hmF2',
    unit: 'km',
    description: '有效 NmF2 对应的原采样高度，不进行亚网格峰拟合。',
  },
  foF2: {
    label: 'foF2',
    unit: 'MHz',
    description: '由模型 Ne 推导的临界频率：8.98×10⁻⁶√NmF2；不是测高仪观测。',
  },
} as const
export type DerivedMetric = keyof typeof DERIVED_METRICS
export interface DerivedCandidate {
  nmF2: number
  hmF2: number
}
export interface DerivedPeak extends DerivedCandidate {
  foF2: number
}
export interface DerivedContent {
  value: number | null
  quality: DerivedQuality
  /** Fraction of requested thickness covered by adjacent valid samples. */
  coverage: number
}
export interface DerivedF2 {
  quality: DerivedQuality
  peak: DerivedPeak | null
  /** Diagnostic only; never usable as a valid F2 result. */
  candidate: DerivedCandidate | null
}
export interface DerivedProfile {
  content: DerivedContent
  f2: DerivedF2
  integrationRange: HeightRange
  f2Window: HeightRange
}
export interface DerivedSampledProfile extends DerivedProfile {
  longitude: number
  latitude: number
  altitudes: number[]
  values: (number | null)[]
}
export type QualityCounts = Record<DerivedQuality, number>
export interface DerivedGrid {
  longitude: IonosphereAxis
  latitude: IonosphereAxis
  /** Full XY grid; X varies fastest and Y increases south to north. */
  values: Record<DerivedMetric, (number | null)[]>
  ranges: Record<DerivedMetric, [number, number] | null>
  eligibleColumns: number
  validContentColumns: number
  validF2Columns: number
  qualityCounts: { content: QualityCounts; f2: QualityCounts }
  meanContent: number | null
  peak: (DerivedPeak & { longitude: number; latitude: number }) | null
  integrationRange: HeightRange
  f2Window: HeightRange
  algorithm: typeof DERIVED_ALGORITHM
}
