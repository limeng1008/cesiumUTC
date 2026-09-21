<template>
  <div class="globe-scene">
    <VcViewer
      class="globe-canvas"
      cesium-path="/cesium/Cesium.js"
      :base-layer="false"
      :animation="false"
      :timeline="false"
      :info-box="false"
      :selection-indicator="false"
      :base-layer-picker="false"
      :geocoder="false"
      :skeleton="false"
      :remove-cesium-script="false"
      :request-render-mode="true"
      :order-independent-translucency="!orderedTransparency"
      :maximum-render-time-change="Infinity"
      :camera="initialCamera"
      @ready="onViewerReady"
      @unready="onViewerError"
    />
    <div v-if="error" class="globe-feedback" role="alert">
      <icon-mdi-earth />
      <h2>地球加载失败</h2>
      <p>{{ error }}</p>
      <n-button secondary type="primary" @click="reloadPage">重新加载</n-button>
    </div>
    <div v-else-if="!ready" class="globe-feedback" role="status">
      <n-spin />
      <p>正在加载三维地球…</p>
    </div>
  </div>
</template>

<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import { NButton, NSpin } from 'naive-ui'
import { VcViewer } from 'vue-cesium'
import 'vue-cesium/dist/index.css'

const props = defineProps({
  grid: { type: Boolean, default: false },
  markers: { type: Boolean, default: false },
  locations: { type: Array, default: () => [] },
  interactive: { type: Boolean, default: true },
  orderedTransparency: { type: Boolean, default: false },
})
const emit = defineEmits(['ready', 'scene-ready', 'error', 'coordinate', 'camera'])
const initialCamera = {
  position: { lng: 108, lat: 25, height: 13500000 },
  heading: 0,
  pitch: -90,
  roll: 0,
}
const ready = ref(false)
const error = ref('')
let C, viewer, gridSource, pointSource, clickHandler
let disposed = false
const cleanups = []

function updateLayers() {
  if (!viewer || viewer.isDestroyed()) return
  if (gridSource) gridSource.show = props.grid
  if (pointSource) pointSource.show = props.markers
  viewer.scene.requestRender()
}
function syncLocations() {
  if (!pointSource || !viewer || viewer.isDestroyed()) return
  pointSource.entities.removeAll()
  for (const location of props.locations) {
    pointSource.entities.add({
      id: location.id,
      position: C.Cartesian3.fromDegrees(location.longitude, location.latitude),
      point: {
        pixelSize: 6,
        color: C.Color.fromCssColorString('#82d3ff'),
        outlineColor: C.Color.fromCssColorString('#123350'),
        outlineWidth: 2,
      },
      label: {
        text: location.name,
        font: '14px sans-serif',
        fillColor: C.Color.fromCssColorString('#cce9ff'),
        style: C.LabelStyle.FILL_AND_OUTLINE,
        outlineColor: C.Color.fromCssColorString('#071421'),
        outlineWidth: 3,
        pixelOffset: new C.Cartesian2(0, -19),
        distanceDisplayCondition: new C.DistanceDisplayCondition(0, 30000000),
      },
    })
  }
  updateLayers()
}
watch(() => [props.grid, props.markers], updateLayers)
watch(() => props.locations, syncLocations)

async function onViewerReady(event) {
  C = event.Cesium
  viewer = event.viewer
  try {
    C.Ion.defaultAccessToken = ''
    viewer.scene.backgroundColor = C.Color.fromCssColorString('#020b13')
    viewer.scene.globe.baseColor = C.Color.fromCssColorString('#092239')
    viewer.scene.globe.enableLighting = false
    viewer.scene.screenSpaceCameraController.enableInputs = props.interactive
    viewer.scene.screenSpaceCameraController.minimumZoomDistance = 1000
    viewer.scene.screenSpaceCameraController.maximumZoomDistance = 50000000
    viewer.resolutionScale = Math.min(window.devicePixelRatio || 1, 2)
    const provider = await C.TileMapServiceImageryProvider.fromUrl(
      '/cesium/Assets/Textures/NaturalEarthII',
      { maximumLevel: 2, credit: 'Natural Earth II · CesiumJS' }
    )
    if (disposed || viewer.isDestroyed()) return
    const imagery = viewer.imageryLayers.addImageryProvider(provider)
    imagery.brightness = 0.66
    imagery.contrast = 1.2
    imagery.saturation = 0.75
    imagery.gamma = 0.85
    gridSource = new C.CustomDataSource('coordinate-grid')
    pointSource = new C.CustomDataSource('example-locations')
    await viewer.dataSources.add(gridSource)
    if (disposed || viewer.isDestroyed()) return
    await viewer.dataSources.add(pointSource)
    if (disposed || viewer.isDestroyed()) return
    const gridColor = C.Color.fromCssColorString('#6997c2').withAlpha(0.22)
    for (let lon = -180; lon < 180; lon += 30) {
      const coords = []
      for (let lat = -85; lat <= 85; lat += 5) coords.push(lon, lat)
      gridSource.entities.add({
        polyline: {
          positions: C.Cartesian3.fromDegreesArray(coords),
          width: 1,
          material: gridColor,
        },
      })
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      const coords = []
      for (let lon = -180; lon <= 180; lon += 5) coords.push(lon, lat)
      gridSource.entities.add({
        polyline: {
          positions: C.Cartesian3.fromDegreesArray(coords),
          width: 1,
          material: gridColor,
        },
      })
    }
    syncLocations()
    const updateCamera = () => emit('camera', viewer.camera.positionCartographic.height / 1000)
    viewer.camera.percentageChanged = 0.05
    cleanups.push(viewer.camera.changed.addEventListener(updateCamera))
    cleanups.push(
      viewer.scene.renderError.addEventListener((_scene, failure) => onViewerError(failure))
    )
    if (props.interactive) {
      clickHandler = new C.ScreenSpaceEventHandler(viewer.scene.canvas)
      clickHandler.setInputAction(({ position }) => {
        const cartesian = viewer.camera.pickEllipsoid(position, viewer.scene.globe.ellipsoid)
        if (!cartesian) {
          emit('coordinate', null)
          return
        }
        const point = C.Cartographic.fromCartesian(cartesian)
        emit('coordinate', {
          longitude: C.Math.toDegrees(point.longitude).toFixed(4),
          latitude: C.Math.toDegrees(point.latitude).toFixed(4),
        })
      }, C.ScreenSpaceEventType.LEFT_CLICK)
    }
    updateCamera()
    ready.value = true
    viewer.scene.requestRender()
    emit('ready', C.VERSION)
    emit('scene-ready', { Cesium: C, viewer })
  } catch (failure) {
    onViewerError(failure)
  }
}
function onViewerError(failure) {
  if (disposed) return
  console.error('Cesium initialization failed:', failure)
  error.value = '请检查浏览器的 WebGL 支持与本地地图资源。'
  ready.value = false
  emit('error', error.value)
}
function flyTo(longitude, latitude, height = 1200000) {
  if (!ready.value || viewer.isDestroyed()) return
  const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1.2
  viewer.camera.flyTo({
    destination: C.Cartesian3.fromDegrees(longitude, latitude, height),
    duration,
  })
}
function flyHome() {
  flyTo(108, 25, 13500000)
}
function flyChina() {
  flyTo(105, 35, 6500000)
}
function setMode(value) {
  if (!ready.value || viewer.isDestroyed()) return
  if (value === '2D') viewer.scene.morphTo2D(0)
  else viewer.scene.morphTo3D(0)
  viewer.scene.requestRender()
}
function zoom(direction) {
  if (!ready.value || viewer.isDestroyed()) return
  const distance = viewer.camera.positionCartographic.height * 0.3
  if (direction > 0) viewer.camera.zoomIn(distance)
  else viewer.camera.zoomOut(distance)
  viewer.scene.requestRender()
}
function reloadPage() {
  window.location.reload()
}
defineExpose({ flyTo, flyHome, flyChina, setMode, zoom })
onBeforeUnmount(() => {
  disposed = true
  cleanups.forEach((remove) => remove())
  if (clickHandler && !clickHandler.isDestroyed()) clickHandler.destroy()
  // VcViewer owns the Viewer and destroys its WebGL resources on unmount.
})
</script>

<style scoped>
.globe-scene {
  position: relative;
  width: 100%;
  height: 100%;
  background: #020b13;
}
.globe-canvas {
  position: absolute !important;
  inset: 0;
}
.globe-feedback {
  position: absolute;
  z-index: 3;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  background: #04111e;
  color: #89aeca;
  text-align: center;
  padding: 25px;
}
.globe-feedback > svg {
  font-size: 36px;
}
.globe-feedback h2 {
  font-size: 20px;
  color: #a8d2f5;
}
.globe-feedback p {
  font-size: 13px;
}
:deep(.cesium-widget-credits) {
  bottom: 4px;
  left: 8px;
  opacity: 0.7;
}
</style>
