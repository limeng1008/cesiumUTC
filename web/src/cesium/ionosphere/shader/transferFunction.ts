import type { ColorMap, VolumeSettings } from '../../../models/ionosphere/IonosphereVolume'
import { normalize } from '../../../utils/ionosphere/normalize'
type RGB = [number, number, number]
/** Shared CPU/GPU control points; interpolation produces a continuous scientific LUT. */
export const colorLUT: Record<ColorMap, RGB[]> = {
  scientific: [
    [0.19, 0.07, 0.23],
    [0.25, 0.32, 0.77],
    [0.12, 0.69, 0.88],
    [0.2, 0.86, 0.52],
    [0.8, 0.89, 0.2],
    [0.98, 0.54, 0.12],
    [0.7, 0.08, 0.12],
  ],
  viridis: [
    [0.267, 0.005, 0.329],
    [0.283, 0.141, 0.458],
    [0.254, 0.265, 0.53],
    [0.207, 0.372, 0.553],
    [0.164, 0.471, 0.558],
    [0.128, 0.567, 0.551],
    [0.135, 0.659, 0.518],
    [0.267, 0.749, 0.441],
    [0.478, 0.821, 0.318],
    [0.741, 0.873, 0.15],
    [0.993, 0.906, 0.144],
  ],
  'blue-red': [
    [0.04, 0.12, 0.6],
    [0.06, 0.37, 0.78],
    [0.04, 0.73, 0.82],
    [0.2, 0.72, 0.4],
    [0.87, 0.86, 0.2],
    [0.91, 0.44, 0.12],
    [0.94, 0.1, 0.08],
  ],
}
export function colorAt(t: number, map: ColorMap): RGB {
  const stops = colorLUT[map],
    p = Math.max(0, Math.min(1, t)) * (stops.length - 1),
    i = Math.min(Math.floor(p), stops.length - 2),
    f = p - i
  return stops[i].map((v, k) => v * (1 - f) + stops[i + 1][k] * f) as RGB
}
/** Values below the threshold remain absent; accepted low values may retain a visible floor. */
export function alphaAt(t: number, low: number, high: number, opacity: number, floor = 0): number {
  if (t < low) return 0
  const s = Math.max(0, Math.min(1, (t - low) / Math.max(high - low, 1e-6)))
  return (floor + (1 - floor) * s * s * (3 - 2 * s)) * opacity
}
export function transfer(
  value: number | null,
  settings: VolumeSettings
): [number, number, number, number] {
  if (
    value === null ||
    !Number.isFinite(value) ||
    (settings.normalization === 'log' && (value <= 0 || settings.valueRange[0] <= 0)) ||
    value < settings.valueRange[0] ||
    value > settings.valueRange[1]
  )
    return [0, 0, 0, 0]
  const t = normalize(value, settings.valueRange, settings.normalization)
  return [
    ...colorAt(t, settings.colorMap),
    alphaAt(
      t,
      settings.thresholdLow,
      settings.thresholdHigh,
      settings.opacity,
      settings.lowValueOpacity
    ),
  ]
}
export function colorGLSL(): string {
  const funcs = Object.entries(colorLUT).map(
    ([_name, stops], index) =>
      `vec3 palette${index}(float t) { float p=clamp(t,0.0,1.0)*${(stops.length - 1).toFixed(
        1
      )}; ${stops
        .slice(0, -1)
        .map(
          (c, i) =>
            `if(p<=${(i + 1).toFixed(1)}) return mix(vec3(${c
              .map((v) => v.toFixed(5))
              .join(',')}),vec3(${stops[i + 1].map((v) => v.toFixed(5)).join(',')}),p-${i.toFixed(
              1
            )});`
        )
        .join('')} return vec3(${stops[stops.length - 1].map((v) => v.toFixed(5)).join(',')}); }`
  )
  return (
    funcs.join('\n') +
    '\nvec3 scientificColor(float t,float palette) { if(palette<0.5)return palette0(t); if(palette<1.5)return palette1(t); return palette2(t); }'
  )
}
export const paletteIndex = (map: ColorMap): number => Object.keys(colorLUT).indexOf(map)
