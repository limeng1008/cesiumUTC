import type { NormalizationMode } from '../../models/ionosphere/IonosphereVolume'
/** Log is log10(Ne); the result is dimensionless in [0,1]. */
export function normalize(
  value: number,
  range: readonly [number, number],
  mode: NormalizationMode
): number {
  let [lo, hi] = range
  if (!Number.isFinite(value) || hi <= lo) return 0
  if (mode === 'log') {
    if (value <= 0 || lo <= 0) return 0
    value = Math.log10(value)
    lo = Math.log10(lo)
    hi = Math.log10(hi)
  }
  return Math.max(0, Math.min(1, (value - lo) / (hi - lo)))
}
export function valueRange(values: Float32Array, noData?: number): [number, number] {
  let lo = Infinity,
    hi = -Infinity
  for (const value of values) {
    if (!Number.isFinite(value)) throw new Error('数据包含 NaN 或 Infinity')
    if (value === noData) continue
    lo = Math.min(lo, value)
    hi = Math.max(hi, value)
  }
  if (!Number.isFinite(lo)) throw new Error('没有有效体数据')
  return [lo, hi]
}
export function scientific(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  if (value === 0) return '0'
  const exponent = Math.floor(Math.log10(Math.abs(value)))
  const superscripts: Record<string, string> = {
    '-': '⁻',
    '0': '⁰',
    '1': '¹',
    '2': '²',
    '3': '³',
    '4': '⁴',
    '5': '⁵',
    '6': '⁶',
    '7': '⁷',
    '8': '⁸',
    '9': '⁹',
  }
  return `${(value / 10 ** exponent).toFixed(2)} × 10${String(exponent)
    .split('')
    .map((c) => superscripts[c])
    .join('')}`
}
