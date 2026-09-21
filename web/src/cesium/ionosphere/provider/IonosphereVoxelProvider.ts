import type * as Cesium from 'cesium'
import type { IonosphereVolume } from '../../../models/ionosphere/IonosphereVolume'
/** Cesium adapter only. Copies one cyclic longitude halo for continuous antimeridian sampling. */
export function createVoxelProvider(
  C: typeof Cesium,
  volume: IonosphereVolume
): Cesium.VoxelProvider {
  const m = volume.metadata,
    nx = m.longitude.count,
    ny = m.latitude.count,
    nz = m.altitude.count
  const density = new Float32Array((nx + 2) * ny * nz),
    valid = new Float32Array(density.length)
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx + 2; x++) {
        const index = z * ny * (nx + 2) + y * (nx + 2) + x,
          v = volume.values[z * ny * nx + y * nx + ((x - 1 + nx) % nx)]
        density[index] = v === m.noDataValue ? 0 : v
        valid[index] = v === m.noDataValue ? 0 : 1
      }
  // VoxelProvider is an interface, not constructible. Runtime accepts structural implementations.
  const provider = {
    globalTransform: C.Matrix4.IDENTITY,
    shapeTransform: C.Matrix4.fromScale(C.Ellipsoid.WGS84.radii),
    shape: C.VoxelShapeType.ELLIPSOID,
    dimensions: new C.Cartesian3(nx, ny, nz),
    paddingBefore: new C.Cartesian3(1, 0, 0),
    paddingAfter: new C.Cartesian3(1, 0, 0),
    minBounds: new C.Cartesian3(-Math.PI, -Math.PI / 2, m.altitude.min * 1000),
    maxBounds: new C.Cartesian3(Math.PI, Math.PI / 2, m.altitude.max * 1000),
    names: ['scalar', 'valid'],
    types: [C.MetadataType.SCALAR, C.MetadataType.SCALAR],
    componentTypes: [C.MetadataComponentType.FLOAT32, C.MetadataComponentType.FLOAT32],
    minimumValues: [[m.minValue], [0]],
    maximumValues: [[m.maxValue], [1]],
    maximumTileCount: 1,
    availableLevels: 1,
    requestData({ tileLevel = 0 } = {}) {
      return tileLevel === 0
        ? Promise.resolve(C.VoxelContent.fromMetadataArray([density, valid]))
        : undefined
    },
  }
  return provider as Cesium.VoxelProvider
}
