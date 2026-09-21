import type { IonosphereAxis, IonosphereVolume } from '../../models/ionosphere/IonosphereVolume'
import { axisCenter, gridIndex } from '../../utils/ionosphere/interpolation'

/** Illustration-only deterministic field. No noise, time dependency or observational claim. */
export function shandongDensity(longitude: number, latitude: number, altitude: number): number {
  const x = (longitude - 114) / 8,
    y = (latitude - 34) / 6.5
  if (x < 0 || x > 1 || y < 0 || y > 1 || altitude < 100 || altitude > 400) return 0
  const smooth = (t: number) => {
    const v = Math.max(0, Math.min(1, t))
    return v * v * (3 - 2 * v)
  }
  const edge = smooth(x / 0.18) * smooth((1 - x) / 0.18) * smooth(y / 0.2) * smooth((1 - y) / 0.2)
  const gaussian = (cx: number, cy: number, sx: number, sy: number) =>
    Math.exp(-0.5 * (((longitude - cx) / sx) ** 2 + ((latitude - cy) / sy) ** 2))
  const horizontal =
    edge * (0.74 * gaussian(116.8, 36.7, 1.25, 0.88) + 0.58 * gaussian(119, 37.2, 1.1, 0.72))
  const vertical = Math.exp(-0.5 * ((altitude - 300) / (altitude <= 300 ? 95 : 65)) ** 2)
  return 1e8 + 9e11 * vertical * horizontal
}

export function createShandongVolume(): IonosphereVolume {
  const axis = (min: number, max: number, count: number): IonosphereAxis => ({
    min,
    max,
    count,
    step: (max - min) / count,
  })
  const longitude = axis(114, 122, 81),
    latitude = axis(34, 40.5, 65),
    altitude = axis(100, 400, 61)
  const values = new Float32Array(longitude.count * latitude.count * altitude.count)
  let minValue = Infinity,
    maxValue = -Infinity
  for (let z = 0; z < altitude.count; z++)
    for (let y = 0; y < latitude.count; y++)
      for (let x = 0; x < longitude.count; x++) {
        const index = gridIndex(x, y, z, longitude.count, latitude.count)
        values[index] = shandongDensity(
          axisCenter(x, longitude),
          axisCenter(y, latitude),
          axisCenter(z, altitude)
        )
        minValue = Math.min(minValue, values[index])
        maxValue = Math.max(maxValue, values[index])
      }
  return {
    values,
    metadata: {
      parameter: 'Ne',
      parameterName: 'Electron Density',
      unit: 'm^-3',
      longitude,
      latitude,
      altitude,
      minValue,
      maxValue,
      sampling: 'cell-center',
      altitudeUnit: 'km',
      order: 'zyx',
      dtype: 'float32',
      byteOrder: 'little',
      source: 'shandong-mock',
      sourceName: '山东局部 · 确定性模拟',
      id: 'shandong-smooth-v1-81x65x61',
      byteLength: values.byteLength,
      validDomain: { latitudeMin: 34, latitudeMax: 40.5, altitudeMin: 100, altitudeMax: 400 },
    },
  }
}
