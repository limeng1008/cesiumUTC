/** 重置样式 */
import '@/styles/reset.css'
import 'uno.css'
import '@/styles/global.scss'
import '@/styles/ionosphere.scss'

import { createApp } from 'vue'
import VueCesium from 'vue-cesium'
import { setupRouter } from '@/router'
import { setupStore, useAppStore } from '@/store'
import App from './App.vue'
import { setupDirectives } from './directives'
import { useResize } from '@/utils'
import i18n from '~/i18n'

async function setupApp() {
  const app = createApp(App)
  app.use(VueCesium, { cesiumPath: '/cesium/Cesium.js', accessToken: '' })

  setupStore(app)
  useAppStore().setDark(true)

  await setupRouter(app)
  setupDirectives(app)
  app.use(useResize)
  app.use(i18n)
  app.mount('#app')
}

setupApp()
