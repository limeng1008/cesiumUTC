import type { AnalysisProfile } from './analysis'
/** Shared scientific axes for regional mean and point curves. No bridging noData. */
export function profilePlot(profiles: AnalysisProfile[], scale: 'linear' | 'log') {
  const valid = (v: number | null): v is number =>
    v !== null && Number.isFinite(v) && (scale === 'log' ? v > 0 : v >= 0)
  const transform = (v: number) => (scale === 'log' ? Math.log10(v) : v)
  const values = profiles.flatMap((p) => p.values.filter(valid).map(transform)),
    heights = profiles.flatMap((p) => p.altitudes)
  if (!values.length || !heights.length) return null
  let low = Math.min(...heights),
    high = Math.max(...heights)
  if (high <= low) {
    low -= 1
    high += 1
  }
  let min = Math.min(...values),
    max = Math.max(...values)
  if (scale === 'log') {
    min = Math.floor(min)
    max = Math.ceil(max)
  }
  if (max <= min) {
    const pad = scale === 'log' ? 1 : Math.max(Math.abs(min) * 0.1, 1)
    min = scale === 'log' ? min - pad : Math.max(0, min - pad)
    max += pad
  }
  const points: { x: number; y: number; value: number; altitude: number }[][] = []
  const paths = profiles.map((p) => {
    let path = '',
      connected = false
    const series: (typeof points)[number] = []
    p.values.forEach((v, i) => {
      if (!valid(v)) {
        connected = false
        return
      }
      const x = 72 + ((transform(v) - min) / (max - min)) * 496,
        y = 258 - ((p.altitudes[i] - low) / (high - low || 1)) * 228
      path += `${connected ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)} `
      connected = true
      series.push({ x, y, value: v, altitude: p.altitudes[i] })
    })
    points.push(series)
    return path
  })
  return {
    paths,
    points,
    low,
    high,
    xTicks: Array.from({ length: 5 }, (_, i) => ({
      x: 72 + i * 124,
      value: min + ((max - min) * i) / 4,
    })),
    yTicks: Array.from({ length: 5 }, (_, i) => ({
      y: 258 - i * 57,
      value: low + ((high - low) * i) / 4,
    })),
  }
}
