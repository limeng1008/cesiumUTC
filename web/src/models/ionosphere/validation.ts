import type { IonosphereVolumeMetadata, IonosphereVolume } from './IonosphereVolume'
import { valueRange } from '../../utils/ionosphere/normalize'
import { isTemperature, scalarParameters } from '../../utils/ionosphere/parameters'
/** Validate untrusted metadata before allocation or GPU upload. */
export function validateMetadata(input: unknown): IonosphereVolumeMetadata {
  if (!input || typeof input !== 'object') throw new Error('Metadata 不是有效对象')
  const m = input as IonosphereVolumeMetadata
  if (
    !scalarParameters.some((p) => p.parameter === m.parameter && p.unit === m.unit) ||
    m.altitudeUnit !== 'km' ||
    m.sampling !== 'cell-center' ||
    m.order !== 'zyx' ||
    m.dtype !== 'float32' ||
    m.byteOrder !== 'little'
  )
    throw new Error('Metadata 坐标、单位或二进制约定不匹配')
  let count = 1
  for (const name of ['longitude', 'latitude', 'altitude'] as const) {
    const a = m[name]
    if (
      !a ||
      ![a.min, a.max, a.count, a.step].every(Number.isFinite) ||
      !Number.isInteger(a.count) ||
      a.count < 2 ||
      a.max <= a.min ||
      Math.abs(a.step - (a.max - a.min) / a.count) > 1e-7
    )
      throw new Error(`Metadata ${name} 网格异常`)
    count *= a.count
  }
  if (
    m.longitude.min !== -180 ||
    m.longitude.max !== 180 ||
    m.latitude.min !== -90 ||
    m.latitude.max !== 90 ||
    m.altitude.min < 0
  )
    throw new Error('需要全球 WGS84 经纬网格与非负高度')
  if (
    count > 2000000 ||
    m.byteLength !== count * 4 ||
    !Number.isFinite(m.minValue) ||
    !Number.isFinite(m.maxValue) ||
    (isTemperature(m.parameter) ? m.minValue <= 0 : m.minValue < 0) ||
    m.maxValue < m.minValue ||
    typeof m.id !== 'string' ||
    !m.id
  )
    throw new Error('Metadata 数据范围、大小或标识异常')
  if (m.noDataValue !== undefined && !Number.isFinite(m.noDataValue))
    throw new Error('noData 必须是有限数值')
  if (m.validDomain !== undefined) {
    const d = m.validDomain
    if (
      !d ||
      ![d.latitudeMin, d.latitudeMax, d.altitudeMin, d.altitudeMax].every(Number.isFinite) ||
      d.latitudeMin < m.latitude.min ||
      d.latitudeMax > m.latitude.max ||
      d.latitudeMax <= d.latitudeMin ||
      d.altitudeMin < m.altitude.min ||
      d.altitudeMax > m.altitude.max ||
      d.altitudeMax <= d.altitudeMin
    )
      throw new Error('Metadata 科学有效范围异常')
  }
  for (const field of [
    'source',
    'sourceName',
    'sourceFile',
    'sourceUrl',
    'sourceVariable',
    'sourceUnit',
    'species',
  ] as const) {
    if (m[field] !== undefined && (typeof m[field] !== 'string' || !m[field]?.trim()))
      throw new Error(`Metadata ${field} 异常`)
  }
  if (
    m.timestamp !== undefined &&
    (typeof m.timestamp !== 'string' || !Number.isFinite(Date.parse(m.timestamp)))
  )
    throw new Error('Metadata 数据时刻异常')
  if (
    m.sourceSha256 !== undefined &&
    (typeof m.sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(m.sourceSha256))
  )
    throw new Error('Metadata 源文件校验值异常')
  return m
}
export function decodeVolume(input: unknown, buffer: ArrayBuffer): IonosphereVolume {
  const metadata = validateMetadata(input)
  if (buffer.byteLength !== metadata.byteLength)
    throw new Error(`二进制长度异常：期望 ${metadata.byteLength}，收到 ${buffer.byteLength}`)
  const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1
  const values = new Float32Array(buffer)
  if (!littleEndian) {
    const view = new DataView(buffer)
    for (let i = 0; i < values.length; i++) values[i] = view.getFloat32(i * 4, true)
  }
  const [lo, hi] = valueRange(values, metadata.noDataValue)
  if (
    Math.abs(lo - metadata.minValue) > Math.max(1, lo) * 1e-6 ||
    Math.abs(hi - metadata.maxValue) > Math.max(1, hi) * 1e-6
  )
    throw new Error('数据 min/max 与 Metadata 不一致')
  return { metadata, values }
}
