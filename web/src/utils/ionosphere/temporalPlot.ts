import type { TemporalRow } from './temporal'
import { colorAt } from '../../cesium/ionosphere/shader/transferFunction'

/** Source slots (including gaps) determine both line continuity and column extents. */
export function temporalPlot(
  rows: TemporalRow[],
  heights: [number, number],
  scale: 'linear' | 'log'
) {
  const valid = (v: number | null): v is number =>
    v !== null && Number.isFinite(v) && (scale === 'log' ? v > 0 : v >= 0)
  const transform = (v: number) => (scale === 'log' ? Math.log10(v) : v)
  const start = rows[0]?.left ?? 0,
    end = rows[rows.length - 1]?.right ?? 1
  const x = (ms: number) => 80 + ((ms - start) / (end - start || 1)) * 620
  const heat = rows.flatMap((r) => r.profile.filter(valid))
  const minimum = heat.length ? Math.min(...heat) : null,
    maximum = heat.length ? Math.max(...heat) : null
  function range(values: number[]) {
    let low = values.length ? Math.min(...values.map(transform)) : 0
    let high = values.length ? Math.max(...values.map(transform)) : 1
    if (low === high) {
      const pad = scale === 'log' ? 0.5 : Math.max(Math.abs(low) * 0.1, 1)
      low = scale === 'log' ? low - pad : Math.max(0, low - pad)
      high += pad
    }
    return [low, high]
  }
  const series = (['point', 'mean', 'maximum'] as const).map((key) => {
    // Mean and maximum use exactly the same y scale.
    const values = rows
      .flatMap((r) => (key === 'point' ? [r.point] : [r.mean, r.maximum]))
      .filter(valid)
    const [low, high] = range(values)
    const points: { x: number; y: number; value: number; timestamp: string }[] = []
    let path = '',
      connected = false
    rows.forEach((r) => {
      const v = r[key]
      if (!valid(v)) {
        connected = false
        return
      }
      const p = {
        x: x(r.milliseconds),
        y: 220 - ((transform(v) - low) / (high - low)) * 180,
        value: v,
        timestamp: r.timestamp,
      }
      path += `${connected ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)} `
      connected = true
      points.push(p)
    })
    return {
      key,
      path,
      points,
      ticks: Array.from({ length: 4 }, (_, i) => ({
        y: 220 - i * 60,
        value:
          scale === 'log' ? 10 ** (low + ((high - low) * i) / 3) : low + ((high - low) * i) / 3,
      })),
    }
  })
  const [lo, hi] = range(heat)
  const cells = rows.flatMap((r) =>
    r.profile.flatMap((v, i) => {
      if (!valid(v)) return []
      const n = r.profile.length,
        bottom = i === 0 ? 0 : (i - 0.5) / (n - 1),
        top = i === n - 1 ? 1 : (i + 0.5) / (n - 1)
      const rgb = colorAt((transform(v) - lo) / (hi - lo), 'blue-red').map((c) =>
        Math.round(c * 255)
      )
      return [
        {
          x: x(r.left),
          width: x(r.right) - x(r.left),
          y: 220 - top * 180,
          height: (top - bottom) * 180,
          color: `rgb(${rgb.join(',')})`,
          value: v,
          altitude: heights[0] + ((heights[1] - heights[0]) * i) / (n - 1 || 1),
          timestamp: r.timestamp,
        },
      ]
    })
  )
  return {
    series,
    cells,
    minimum,
    maximum,
    colorMinimum: scale === 'log' ? 10 ** lo : lo,
    colorMaximum: scale === 'log' ? 10 ** hi : hi,
    timeTicks: Array.from({ length: 5 }, (_, i) => ({
      x: 80 + i * 155,
      value: start + ((end - start) * i) / 4,
    })),
    heightTicks: Array.from({ length: 4 }, (_, i) => ({
      y: 220 - i * 60,
      value: heights[0] + ((heights[1] - heights[0]) * i) / 3,
    })),
  }
}
