import type { Dataset, ImportTask } from '../../models/ionosphere/Dataset'
import type { IonosphereVolume } from '../../models/ionosphere/IonosphereVolume'
import { analyzeGrid } from './analysis'
import { sampleVolume } from './interpolation'
import { sanitizeRegion, type GeographicRegion } from './region'

export interface TemporalConditions {
  longitude: number
  latitude: number
  altitude: number
  heights: [number, number]
  region: GeographicRegion | null
}
export interface TimeSlot {
  index: number
  timestamp: string
  milliseconds: number
  left: number
  right: number
  task?: ImportTask
  status: string
}
export interface TemporalRow extends TimeSlot {
  point: number | null
  mean: number | null
  maximum: number | null
  count: number
  profile: (number | null)[]
  coverage?: [number, number]
  error?: string
}
export function timeSlots(dataset: Dataset, start: number, end: number): TimeSlot[] {
  if (![start, end].every(Number.isFinite) || start > end) throw new Error('UTC 时间范围无效')
  const times = dataset.preview?.times
  if (!times?.length) throw new Error('文件没有可用时间索引，请在数据管理重新检查文件')
  const all = times
    .map((t) => ({ ...t, milliseconds: Date.parse(t.timestamp) }))
    .sort((a, b) => a.milliseconds - b.milliseconds)
  const indices = new Set<number>(),
    stamps = new Set<number>()
  for (const t of all) {
    if (!Number.isFinite(t.milliseconds) || !Number.isInteger(t.index) || t.index < 0)
      throw new Error('文件时间索引无效')
    if (indices.has(t.index) || stamps.has(t.milliseconds)) throw new Error('文件时间索引重复')
    indices.add(t.index)
    stamps.add(t.milliseconds)
  }
  const selected = all.filter((t) => t.milliseconds >= start && t.milliseconds <= end)
  if (!selected.length) throw new Error('所选时间范围内没有源文件时刻')
  if (selected.length > 256) throw new Error('一次最多分析 256 个源时刻，请缩小 UTC 时间范围')
  return all
    .map((t, i) => {
      const matches = dataset.imports
        .filter(
          (task) =>
            task.datasetId === dataset.id &&
            (task.parameter || 'Ne') === 'Ne' &&
            task.timeIndex === t.index &&
            Date.parse(task.timestamp) === t.milliseconds
        )
        .sort(
          (a, b) =>
            (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0) ||
            b.id.localeCompare(a.id)
        )
      const task = matches.find((task) => task.status === 'ready')
      return {
        ...t,
        task,
        status: task ? 'waiting' : matches[0]?.status || 'unimported',
        left: i
          ? (all[i - 1].milliseconds + t.milliseconds) / 2
          : t.milliseconds - (all[1] ? (all[1].milliseconds - t.milliseconds) / 2 : 300000),
        right:
          i < all.length - 1
            ? (all[i + 1].milliseconds + t.milliseconds) / 2
            : t.milliseconds + (i ? (t.milliseconds - all[i - 1].milliseconds) / 2 : 300000),
      }
    })
    .filter((t) => t.milliseconds >= start && t.milliseconds <= end)
}
export function validateConditions(c: TemporalConditions) {
  if (
    ![c.longitude, c.latitude, c.altitude, ...c.heights].every(Number.isFinite) ||
    Math.abs(c.longitude) > 180 ||
    Math.abs(c.latitude) > 90
  )
    throw new Error('经纬度和高度必须为有效数值（经度 ±180°，纬度 ±90°）')
  if (
    c.heights[0] < 0 ||
    c.heights[0] >= c.heights[1] ||
    c.altitude < c.heights[0] ||
    c.altitude > c.heights[1]
  )
    throw new Error('高度范围须递增，固定高度须在范围内')
  if (c.region && !sanitizeRegion(c.region)) throw new Error('研究区域经纬度边界无效')
}
export function profileHeights(heights: [number, number]) {
  return Array.from({ length: 64 }, (_, i) => heights[0] + ((heights[1] - heights[0]) * i) / 63)
}
export function summarize(volume: IonosphereVolume, conditions: TemporalConditions) {
  validateConditions(conditions)
  const c = conditions,
    stats = analyzeGrid(volume, c.region, c.heights)
  const at = (h: number) => {
    const v = sampleVolume(volume, c.longitude, c.latitude, h)
    return v !== null && Number.isFinite(v) && v >= 0 && v !== volume.metadata.noDataValue
      ? v
      : null
  }
  return {
    point: at(c.altitude),
    mean: stats.mean,
    maximum: stats.maximum,
    count: stats.count,
    profile: profileHeights(c.heights).map(at),
    coverage: [
      Math.max(volume.metadata.altitude.min, volume.metadata.validDomain?.altitudeMin ?? -Infinity),
      Math.min(volume.metadata.altitude.max, volume.metadata.validDomain?.altitudeMax ?? Infinity),
    ] as [number, number],
  }
}
