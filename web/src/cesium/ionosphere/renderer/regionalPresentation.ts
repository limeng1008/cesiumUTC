import type {
  IonosphereVolumeMetadata,
  VolumeSettings,
} from '../../../models/ionosphere/IonosphereVolume'
import { displayRegion } from '../../../utils/ionosphere/region'
import { visibleSliceHeights } from '../../../utils/ionosphere/slices'

/** Presentation follows the selected domain, never the data source's identity. */
export function regionalPresentation(metadata: IonosphereVolumeMetadata, settings: VolumeSettings) {
  if (!settings.region || settings.opacity <= 0) return null
  const region = displayRegion(settings.region, metadata)
  if (!region) return null
  const slices = visibleSliceHeights(settings)
  if (!settings.volumeVisible && !settings.section?.visible && !slices.length) return null
  const heights: [number, number] =
    settings.volumeVisible || settings.section?.visible
      ? [...settings.altitudeRange]
      : [slices[0], slices[slices.length - 1]]
  // A single slice gets a small contextual envelope; slice altitude is unchanged.
  if (heights[0] === heights[1]) {
    heights[0] = Math.max(metadata.altitude.min, heights[0] - 5)
    heights[1] = Math.min(metadata.altitude.max, heights[1] + 5)
  }
  const segments =
    region.east < region.west
      ? [
          [region.west, 180],
          [-180, region.east],
        ]
      : [[region.west, region.east]]
  const province =
    metadata.source === 'shandong-mock' &&
    region.north >= 34 &&
    region.south <= 40.5 &&
    segments.some(([west, east]) => west <= 122 && east >= 114)
  return { region, heights, province }
}
