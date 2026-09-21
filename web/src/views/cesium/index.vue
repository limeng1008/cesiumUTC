<template>
  <section class="overview-page">
    <header class="overview-sourcebar">
      <div class="overview-heading">
        <h1>全球电离层总览</h1>
        <small>GLOBAL IONOSPHERE · SAMI3</small>
      </div>
      <label
        >分析数据
        <select
          :value="store.datasetId"
          aria-label="首页分析数据集"
          :disabled="store.catalogLoading"
          @change="store.selectDataset($event.target.value)"
        >
          <option v-if="!store.datasets.length" value="">暂无可分析数据</option>
          <option v-for="d in store.datasets" :key="d.id" :value="d.id">
            {{ d.name || d.originalName }} · {{ d.id.slice(0, 8) }}
          </option>
        </select>
      </label>
      <label
        >模型时刻 · UTC
        <select
          :value="store.timeIndex"
          aria-label="首页模型时刻"
          :disabled="!store.times.length"
          @change="store.selectTime(Number($event.target.value))"
        >
          <option v-for="t in store.times" :key="t.index" :value="t.index">
            {{ utc(t.timestamp) }}
          </option>
        </select>
      </label>
      <div class="overview-source-actions">
        <span>{{ store.totalDatasets }} 个文件 · 当前文件 {{ readyImports }} 个已入库时刻</span>
        <div>
          <router-link to="/data-management">数据管理 ↗</router-link>
          <router-link
            v-if="store.currentImport"
            :to="{ path: '/ionosphere', query: { importId: store.currentImport.id } }"
            >三维分析 ↗</router-link
          >
          <button :disabled="store.catalogLoading" @click="store.initialize()">刷新</button>
        </div>
      </div>
    </header>
    <div class="overview-workspace">
      <main class="overview-main">
        <div class="overview-map">
          <GlobeScene
            ref="globe"
            :grid="showGrid"
            :markers="!!store.point"
            :locations="locations"
            @ready="ready = true"
            @scene-ready="onScene"
            @error="sceneError = String($event)"
            @coordinate="pick"
            @camera="cameraHeight = $event"
          />
          <details class="overview-parameters" open>
            <summary>
              电离层关键参数 <span>{{ store.point ? '选定位置' : '全球' }}</span>
            </summary>
            <dl>
              <div>
                <dt>
                  {{ store.point ? '有效 F2 峰值' : '全球最大有效 F2 峰值' }} <small>NmF2</small>
                </dt>
                <dd>{{ scientific(peak?.nmF2) }} <small>m⁻³</small></dd>
              </div>
              <div>
                <dt>同位置峰值高度 <small>hmF2</small></dt>
                <dd>{{ number(peak?.hmF2) }} <small>km</small></dd>
              </div>
              <div>
                <dt>同位置临界频率 <small>foF2</small></dt>
                <dd>{{ number(peak?.foF2, 2) }} <small>MHz</small></dd>
              </div>
              <div>
                <dt>{{ store.point ? '选点区间电子含量' : '面积加权区间电子含量' }}</dt>
                <dd>
                  {{ number(store.point ? store.profile?.tec : store.analysis?.meanTec) }}
                  <small>TECU</small>
                </dd>
              </div>
              <div>
                <dt>地磁活动指数 <small>Kp</small></dt>
                <dd>{{ number(store.weather?.kp, 2) }} <small>历史观测</small></dd>
              </div>
            </dl>
            <p v-if="store.point">
              选点 {{ store.point.longitude.toFixed(2) }}°, {{ store.point.latitude.toFixed(2) }}°
              <button class="text-button" @click="store.point = null">返回全球</button>
            </p>
            <p v-else-if="store.analysis?.peak">
              F2 峰值位置 {{ store.analysis.peak.longitude.toFixed(2) }}°,
              {{ store.analysis.peak.latitude.toFixed(2) }}°
            </p>
            <p>F2 搜索 200–600 km · 网格峰值估计</p>
            <p v-if="store.analysis">
              区间积分 {{ store.analysis.altitudeRange.join('–') }} km · 非完整 VTEC
            </p>
            <p v-if="store.analysis">
              有效 F2 柱 {{ store.analysis.validF2Columns }} / {{ store.analysis.eligibleColumns }}
            </p>
            <p v-if="store.analysis && !peak" class="overview-warning">
              无可靠 F2 峰{{
                store.point && store.profile
                  ? '：' + DERIVED_QUALITY_LABELS[store.profile.f2Quality]
                  : ''
              }}
            </p>
            <p v-if="store.point && store.profile?.tec === null" class="overview-warning">
              选点超出有效范围或存在缺测
            </p>
            <p class="model-note">模型 Ne 推导 · 非测高仪观测 · ne-derived-v1</p>
          </details>
          <div class="overview-map-tools">
            <button
              v-for="m in ['2D', '3D']"
              :key="m"
              :class="{ active: mode === m }"
              :disabled="!ready"
              @click="setMode(m)"
            >
              {{ m }}
            </button>
            <details class="overview-layer-options">
              <summary>图层</summary>
              <div>
                <label><input v-model="store.showTec" type="checkbox" />柱 TEC 图层</label>
                <label><input v-model="showGrid" type="checkbox" />经纬网</label>
                <label
                  >透明度 {{ Math.round(store.opacity * 100) }}%<input
                    v-model.number="store.opacity"
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    aria-label="TEC 图层透明度"
                /></label>
              </div>
            </details>
          </div>
          <div class="overview-navigation">
            <button :disabled="!ready" @click="globe?.flyHome()">全球</button
            ><button :disabled="!ready" @click="globe?.flyChina()">中国</button>
            <button :disabled="!ready" aria-label="放大地球" @click="globe?.zoom(1)">＋</button
            ><button :disabled="!ready" aria-label="缩小地球" @click="globe?.zoom(-1)">−</button>
          </div>
          <div v-if="store.loading || store.catalogLoading" class="overview-notice" role="status">
            正在读取
            {{ store.times.find((t) => t.index === store.timeIndex)?.timestamp || '数据目录' }}…
          </div>
          <div v-else-if="store.error" class="overview-notice overview-warning" role="alert">
            {{ store.error }} <button @click="store.initialize()">重试</button>
          </div>
          <div v-else-if="!store.frame" class="overview-notice">
            尚无可分析的真实数据，请先<router-link to="/data-management">导入数据文件</router-link
            >。
          </div>
          <div v-if="sceneError || layerError" class="overview-render-error" role="alert">
            {{ sceneError || layerError }}
          </div>
          <div class="overview-map-bottom">
            <div v-if="store.analysis?.range" class="overview-legend" aria-label="动态 TEC 色标">
              <span>柱 TEC · TECU · 线性</span>
              <div
                class="overview-colorbar"
                :style="{ background: legendBackground }"
                :class="{ constant: store.analysis.range[0] === store.analysis.range[1] }"
              ></div>
              <div class="chart-ticks">
                <span>{{ number(store.analysis.range[0]) }}</span
                ><span>{{ number(store.analysis.range[1]) }}</span>
              </div>
              <small
                >{{ store.analysis.altitudeRange.join('–') }} km ·
                {{ store.analysis.validColumns }} 个有效网格柱</small
              >
            </div>
            <div class="overview-caption">
              <span
                >当前显示
                {{ store.frame ? utc(store.frame.metadata.timestamp) + ' UTC' : '—' }}</span
              >
              <small
                >WGS84 · {{ ready ? '地球已就绪' : '地球加载中' }} · 视点
                {{ number(cameraHeight, 0) }} km · 点击地球选点</small
              >
            </div>
          </div>
        </div>
        <div class="overview-timeline">
          <button
            :disabled="!store.playing && (!store.frame || store.loading || atLast)"
            :aria-label="store.playing ? '暂停时间回放' : '播放时间回放'"
            @click="store.togglePlay()"
          >
            {{ store.playing ? '暂停' : '播放' }}
          </button>
          <button
            :disabled="store.loading || store.timeIndex <= 0"
            aria-label="上一时刻"
            @click="store.selectTime(store.timeIndex - 1)"
          >
            ‹
          </button>
          <label
            ><span>时间变化回放 <small>真实文件时刻逐帧读取</small></span>
            <input
              type="range"
              min="0"
              :max="Math.max(0, store.times.length - 1)"
              :value="store.timeIndex"
              :disabled="!store.times.length"
              aria-label="首页时间轴"
              @change="store.selectTime(Number($event.target.value))"
            />
          </label>
          <button
            :disabled="store.loading || !store.times.length || atLast"
            aria-label="下一时刻"
            @click="store.selectTime(store.timeIndex + 1)"
          >
            ›
          </button>
          <span>{{ store.times.length ? store.timeIndex + 1 : 0 }} / {{ store.times.length }}</span>
        </div>
      </main>
      <aside class="overview-analysis" aria-label="电离层分析面板">
        <OverviewCharts kind="tec" /><OverviewCharts kind="profile" /><OverviewCharts
          kind="trend"
        />
        <section class="overview-chart overview-weather">
          <header>
            <h2>空间天气 · 地磁活动</h2>
            <small>HISTORICAL Kp</small>
          </header>
          <div v-if="store.weatherLoading" class="chart-empty">正在匹配同一时刻历史观测…</div>
          <template v-else-if="store.weather?.available">
            <div class="weather-value">
              <b>{{ number(store.weather.kp, 3) }}</b
              ><span>Kp · {{ store.weather.level }}</span>
            </div>
            <p>{{ store.weather.label }}</p>
            <p>
              {{ utc(store.weather.intervalStart) }} — {{ clock(store.weather.intervalEnd) }} UTC
            </p>
          </template>
          <p v-else>
            {{ store.weatherError || store.weather?.reason || '当前时刻尚无可用历史观测' }}
          </p>
          <p v-if="store.weather">
            <a :href="store.weather.sourceUrl" target="_blank" rel="noopener noreferrer"
              >{{ store.weather.source }} ↗</a
            >
          </p>
          <p>独立地磁观测分级，非预报、非当前实时警报。</p>
          <button :disabled="!store.frame || store.weatherLoading" @click="store.refreshWeather()">
            重新获取历史 Kp
          </button>
        </section>
      </aside>
    </div>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { DERIVED_QUALITY_LABELS } from '@/models/ionosphere/Derived'
import GlobeScene from '@/components/ionosphere/GlobeScene.vue'
import OverviewCharts from '@/components/ionosphere/OverviewCharts.vue'
import { useOverviewStore } from '@/store/ionosphere/overview'
import { TecLayer } from '@/cesium/ionosphere/renderer/TecLayer'
import { colorLUT, colorAt } from '@/cesium/ionosphere/shader/transferFunction'
const store = useOverviewStore(),
  globe = ref(null),
  ready = ref(false),
  mode = ref('3D'),
  showGrid = ref(false)
const cameraHeight = ref(null),
  sceneError = ref(''),
  layerError = ref('')
const peak = computed(() => (store.point ? store.profile?.peak : store.analysis?.peak))
const rgb = (color) => `rgb(${color.map((c) => Math.round(c * 255)).join(',')})`
const legendBackground = computed(() => {
  const range = store.analysis?.range
  return range && range[0] === range[1]
    ? rgb(colorAt(0.5, 'blue-red'))
    : `linear-gradient(to right, ${colorLUT['blue-red'].map(rgb).join(',')})`
})
const readyImports = computed(
  () => store.dataset?.imports.filter((i) => i.status === 'ready').length || 0
)
const atLast = computed(() => store.timeIndex >= store.times.length - 1)
const locations = computed(() =>
  store.point ? [{ id: 'overview-probe', name: '分析点', ...store.point }] : []
)
const number = (v, digits = 1) => (Number.isFinite(v) ? v.toFixed(digits) : '—')
const scientific = (v) => (Number.isFinite(v) ? v.toExponential(2) : '—')
const utc = (v) => (v ? new Date(v).toISOString().slice(0, 19).replace('T', ' ') : '—')
const clock = (v) => (v ? new Date(v).toISOString().slice(11, 16) : '—')
let layer = null,
  disposed = false,
  layerGeneration = 0
function onScene({ Cesium, viewer }) {
  layer?.destroy()
  layer = new TecLayer(Cesium, viewer)
  layer.setAppearance(store.showTec, store.opacity)
  void updateLayer()
}
async function updateLayer() {
  const generation = ++layerGeneration
  layerError.value = ''
  try {
    await layer?.update(store.analysis)
  } catch (error) {
    if (!disposed && generation === layerGeneration)
      layerError.value = 'TEC 图层加载失败：' + String(error)
  }
}
function setMode(value) {
  mode.value = value
  globe.value?.setMode(value)
}
function pick(value) {
  if (value && store.frame) store.pick(Number(value.longitude), Number(value.latitude))
}
watch(() => store.analysis, updateLayer)
watch(
  () => [store.showTec, store.opacity],
  () => layer?.setAppearance(store.showTec, store.opacity)
)
onMounted(() => store.initialize())
onBeforeUnmount(() => {
  disposed = true
  layerGeneration++
  store.dispose()
  layer?.destroy()
  layer = null
})
</script>

<style lang="scss" src="./overview.scss"></style>
