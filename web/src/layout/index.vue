<template>
  <div class="observatory-shell">
    <header class="observatory-header">
      <router-link to="/globe" class="brand-link" aria-label="全球电离层分析系统首页">
        <SystemBrand />
      </router-link>
      <p class="header-motto">探索电离层 <span>·</span> 服务通信导航 <span>·</span> 守护空间环境</p>
      <div class="header-tools">
        <time class="utc-clock" :datetime="utcISO">{{ utcText }} <span>(UTC)</span></time>
        <span class="header-separator"></span>
        <n-button quaternary circle aria-label="系统设置" @click="router.push('/settings')">
          <template #icon><icon-mdi-cog-outline /></template>
        </n-button>
        <n-dropdown trigger="click" :options="accountOptions" @select="onAccountAction">
          <n-button quaternary class="account-trigger" aria-label="用户菜单">
            <icon-mdi-account-outline /><span class="account-name">{{
              userStore.name || '用户'
            }}</span
            ><icon-mdi-chevron-down />
          </n-button>
        </n-dropdown>
      </div>
    </header>
    <aside class="observatory-sidebar">
      <SideBar />
      <div class="sidebar-foot">
        <span class="sidebar-indicator"></span><span>基础框架已就绪</span>
      </div>
    </aside>
    <main id="main-content" class="observatory-content">
      <AppMain />
    </main>
    <footer class="observatory-footer">
      <span class="footer-brand">IONOSPHERE <b>3D</b></span>
      <span class="footer-divider">›</span>
      <span class="footer-caption">数据连接天地 · 科技服务未来</span>
      <span class="footer-status">电离层数据：模型与模拟网格 · 非实测数据</span>
      <a href="https://cesium.com/cesiumjs/" target="_blank" rel="noopener noreferrer"
        >Powered by CesiumJS</a
      >
    </footer>
  </div>
</template>

<script setup>
import { computed, h, onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NButton, NDropdown } from 'naive-ui'
import LogoutIcon from '~icons/mdi/logout'
import SystemBrand from '@/components/ionosphere/SystemBrand.vue'
import SideBar from './components/sidebar/index.vue'
import AppMain from './components/AppMain.vue'
import { useUserStore } from '@/store'

const router = useRouter()
const userStore = useUserStore()
const now = ref(new Date())
const utcISO = computed(() => now.value.toISOString())
const utcText = computed(() => utcISO.value.replace('T', ' ').slice(0, 19))
const timer = setInterval(() => {
  now.value = new Date()
}, 1000)
onBeforeUnmount(() => clearInterval(timer))
const accountOptions = [{ label: '退出登录', key: 'logout', icon: () => h(LogoutIcon) }]
function onAccountAction(key) {
  if (key === 'logout') userStore.logout()
}
</script>
