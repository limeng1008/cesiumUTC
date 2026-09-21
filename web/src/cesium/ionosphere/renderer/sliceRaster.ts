import type { IonosphereVolume, VolumeSettings } from '../../../models/ionosphere/IonosphereVolume'
import { displayRegion, longitudeSpan } from '../../../utils/ionosphere/region'
import { sampleVolume } from '../../../utils/ionosphere/interpolation'
import { transfer } from '../shader/transferFunction'

/** Cell-centred texels sampled from the original volume, not re-normalized per slice. */
export function createSliceRaster(
  volume: IonosphereVolume,
  settings: VolumeSettings,
  altitude: number,
  width = 360,
  height = 180
) {
  const region = displayRegion(settings.region, volume.metadata)
  if (!region) return null
  const pixels = new Uint8ClampedArray(width * height * 4)
  const span = longitudeSpan(region)
  for (let y = 0; y < height; y++) {
    const latitude = region.north - ((y + 0.5) / height) * (region.north - region.south)
    for (let x = 0; x < width; x++) {
      const longitude = region.west + ((x + 0.5) / width) * span
      const rgba = transfer(
        sampleVolume(volume, longitude, latitude, altitude, settings.interpolation),
        settings
      )
      for (let c = 0; c < 4; c++) pixels[(y * width + x) * 4 + c] = Math.round(rgba[c] * 255)
    }
  }
  return { region, pixels, width, height }
}
