<template>
  <GlobeScene ref="scene" :ordered-transparency="true" @scene-ready="connect" @error="store.fail" />
</template>
<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import GlobeScene from './GlobeScene.vue'
import { CesiumVoxelRenderer } from '@/cesium/ionosphere/renderer/CesiumVoxelRenderer'
import { useVolumeStore } from '@/store/ionosphere/volume'
const scene = ref(null),
  store = useVolumeStore()
const route = useRoute()
watch(
  () => route.query.importId,
  (value) => {
    // Malformed nonempty query must fail at the API, never silently fall back to a demo.
    store.selectImport(
      value == null
        ? undefined
        : typeof value === 'string'
        ? value || 'invalid-import-id'
        : 'invalid-import-id'
    )
  },
  { immediate: true }
)
function connect({ Cesium, viewer }) {
  try {
    store.attach(new CesiumVoxelRenderer(Cesium, viewer, store.rendererEvents))
  } catch (error) {
    store.fail(error.message)
  }
}
defineExpose({
  home: () => scene.value?.flyHome(),
  china: () => scene.value?.flyChina(),
  polar: () => scene.value?.flyTo(0, 85, 14000000),
  side: () => scene.value?.flyTo(-70, 0, 13500000),
  zoom: (direction) => scene.value?.zoom(direction),
})
onBeforeUnmount(() => store.detach())
</script>
