import type { VolumeSettings } from '../../models/ionosphere/IonosphereVolume'

export function sanitizeSliceHeights(values: number[], min: number, max: number): number[] {
  const heights = [
    ...new Set(
      (Array.isArray(values) ? values : []).filter(
        (h) => Number.isFinite(h) && h >= min && h <= max
      )
    ),
  ]
    .sort((a, b) => a - b)
    .slice(0, 4)
  return heights.length ? heights : [(min + max) / 2]
}
export function visibleSliceHeights(settings: VolumeSettings): number[] {
  if (!settings.sliceVisible) return []
  const heights =
    settings.sliceMode === 'multiple' ? settings.sliceAltitudes : [settings.sliceAltitude]
  return heights.filter((h) => h >= settings.altitudeRange[0] && h <= settings.altitudeRange[1])
}
