<template>
  <section class="volume-page">
    <header class="volume-page-heading">
      <div>
        <h1>三维电离层参数场</h1>
        <p>3D Ionospheric Parameter Field</p>
      </div>
      <router-link
        v-if="store.importId && store.metadata && !store.loading && store.parameter === 'Ne'"
        class="data-badge"
        :to="{ path: '/analysis', query: { importId: store.importId } }"
        >数据分析 ↗</router-link
      >
      <span class="data-badge"
        >{{ store.metadata ? store.parameter : '参数场' }} · {{ store.sourceLabel }}</span
      >
    </header>
    <div class="volume-workspace">
      <VolumeControlPanel />
      <div class="volume-center">
        <div
          class="volume-viewport"
          :aria-label="'WGS84 三维' + store.parameterLabel + '体渲染视图'"
        >
          <VolumeScene ref="scene" />
          <div class="volume-toolbar" aria-label="地球视角控制">
            <button @click="scene?.home()">全球</button><button @click="scene?.china()">亚洲</button
            ><button @click="scene?.side()">侧向</button
            ><button @click="scene?.polar()">极区</button
            ><button aria-label="放大地球" @click="scene?.zoom(1)">＋</button
            ><button aria-label="缩小地球" @click="scene?.zoom(-1)">−</button>
          </div>
          <div v-if="store.drawingRegion" class="volume-drawing-hint" role="status">
            {{ store.regionHint || '在地球表面依次点击两个角点；按 Esc 取消' }}
          </div>
          <div v-if="store.drawingSection" class="volume-drawing-hint" role="status">
            {{ store.sectionHint }}
          </div>
          <div v-if="!store.importId && !store.loading" class="volume-loading" role="status">
            请选择已入库数据；暂无数据时请前往数据管理上传并入库。
          </div>
          <div v-if="store.loading" class="volume-loading" role="status">
            <n-spin size="small" /><span>{{ store.status }}</span>
          </div>
          <div v-if="store.error" class="volume-error" role="alert">
            <strong>三维电离层加载异常</strong>
            <p>{{ store.error }}</p>
            <button @click="store.reload">重试当前数据源</button>
          </div>
        </div>
        <VolumeLegend
          v-if="store.metadata && !store.loading && !store.rangeEmpty"
          :settings="store.settings"
        />
        <p v-if="store.rangeEmpty" class="volume-status" role="status">
          当前区域无有效数据，请调整区域或高度范围。
        </p>
        <p
          v-else-if="
            store.rangeStatistics?.range?.[0] === store.rangeStatistics?.range?.[1] &&
            store.rangeStatistics?.range
          "
          class="volume-status"
        >
          常量场：{{ store.parameter }}={{ store.rangeStatistics.range[0] }}
          {{ store.unitLabel }}，色标显示跨度已微量扩展。
        </p>
        <SectionPlot />
        <p class="volume-status" role="status">
          {{ store.status }}<span>低于阈值隐藏 · 非实测数据</span>
        </p>
      </div>
      <VolumeProbePanel :debug="debug" />
    </div>
  </section>
</template>
<script setup>
import { ref } from 'vue'
import { useRoute } from 'vue-router'
import { NSpin } from 'naive-ui'
import VolumeScene from '@/components/ionosphere/VolumeScene.vue'
import VolumeControlPanel from '@/components/ionosphere/VolumeControlPanel.vue'
import VolumeLegend from '@/components/ionosphere/VolumeLegend.vue'
import VolumeProbePanel from '@/components/ionosphere/VolumeProbePanel.vue'
import SectionPlot from '@/components/ionosphere/SectionPlot.vue'
import { useVolumeStore } from '@/store/ionosphere/volume'
import './volume.scss'
const scene = ref(null),
  store = useVolumeStore(),
  route = useRoute()
const debug = import.meta.env.DEV && route.query.debugIonosphere === '1'
</script>
