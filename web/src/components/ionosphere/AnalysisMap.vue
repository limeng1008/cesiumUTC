<template>
  <section class="analysis-panel analysis-map-panel" aria-label="研究区域地图">
    <header class="analysis-panel-head">
      <div>
        <h2>研究区域与采样点</h2>
        <small>WGS84 · 点击地球查看高度剖面</small>
      </div>
    </header>
    <div class="analysis-map">
      <GlobeScene
        ref="globe"
        :grid="true"
        :markers="true"
        :locations="locations"
        @scene-ready="ready"
        @coordinate="coordinate"
      />
      <div class="analysis-map-tools">
        <button @click="globe?.flyHome()">全球</button
        ><button @click="globe?.flyChina()">亚洲</button
        ><button :disabled="!drawing || !enabled" @click="startDrawing">绘制区域</button
        ><button v-if="active" @click="drawing?.cancel()">取消绘制</button
        ><button :disabled="!region || !enabled" @click="$emit('region', null)">清除区域</button>
      </div>
      <p v-if="active" class="analysis-map-hint" role="status">{{ hint }}</p>
    </div>
    <p class="analysis-note">
      {{
        region
          ? `${region.west.toFixed(2)}° → ${region.east.toFixed(2)}° / ${region.south.toFixed(
              2
            )}°–${region.north.toFixed(2)}°${region.east < region.west ? ' · 跨日期变更线' : ''}`
          : '全数据范围 · 可绘制矩形，或使用左侧坐标输入'
      }}
    </p>
  </section>
</template>
<script setup>
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import GlobeScene from './GlobeScene.vue'
import { RegionDrawing } from '@/cesium/ionosphere/interaction/RegionDrawing'
const props = defineProps({
  region: { type: Object, default: null },
  point: { type: Object, default: null },
  enabled: { type: Boolean, default: false },
})
const emit = defineEmits(['region', 'point'])
const globe = ref(null),
  drawing = shallowRef(null),
  active = ref(false),
  hint = ref('')
let C,
  viewer,
  box,
  suppressPick = false,
  disposed = false,
  pendingPaint = false,
  removePostUpdate
const locations = computed(() =>
  props.enabled && props.point ? [{ ...props.point, id: 'analysis-point', name: '采样点' }] : []
)
function ready(event) {
  if (disposed) return
  C = event.Cesium
  viewer = event.viewer
  // Entity geometry is built asynchronously. The initial request can finish
  // before the rectangle is ready, so request one last frame at readiness.
  removePostUpdate = viewer.scene.postUpdate.addEventListener(() => {
    if (!pendingPaint && !active.value) return
    viewer.scene.requestRender()
    // .ready is sticky after the first successful update. Only update()'s
    // return value reports whether newly added entity geometry is ready now.
    if (viewer.dataSourceDisplay.update(viewer.clock.currentTime)) pendingPaint = false
  })
  drawing.value = new RegionDrawing(C, viewer, {
    selected: (r) => emit('region', r),
    active: (value) => {
      active.value = value
      if (!value)
        setTimeout(() => {
          suppressPick = false
        }, 0)
    },
    hint: (value) => {
      hint.value = value
    },
  })
  syncRegion()
}
function startDrawing() {
  suppressPick = true
  drawing.value?.start()
  suppressPick = true
}
function coordinate(p) {
  if (props.enabled && p && !active.value && !suppressPick)
    emit('point', { longitude: Number(p.longitude), latitude: Number(p.latitude) })
}
function syncRegion() {
  if (!viewer || viewer.isDestroyed()) return
  if (box) viewer.entities.remove(box)
  box = null
  const r = props.region
  if (r && props.enabled)
    box = viewer.entities.add({
      rectangle: {
        coordinates: C.Rectangle.fromDegrees(r.west, r.south, r.east, r.north),
        height: 1000,
        material: C.Color.CYAN.withAlpha(0.12),
        outline: true,
        outlineColor: C.Color.CYAN,
      },
    })
  queuePaint()
}
function queuePaint() {
  if (!viewer || viewer.isDestroyed()) return
  pendingPaint = true
  viewer.scene.requestRender()
}
watch(() => props.point, queuePaint, { flush: 'post' })
watch(
  () => [props.region, props.enabled],
  () => {
    if (!props.enabled) drawing.value?.cancel()
    syncRegion()
  }
)
onBeforeUnmount(() => {
  disposed = true
  removePostUpdate?.()
  drawing.value?.destroy()
  if (box && viewer && !viewer.isDestroyed()) viewer.entities.remove(box)
})
</script>
