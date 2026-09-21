<template>
  <div class="login-shell">
    <header class="login-header">
      <SystemBrand /><span class="login-access-label">访问控制 / SYSTEM ACCESS</span>
    </header>
    <main class="login-main">
      <section v-if="showVisual" class="login-visual" aria-label="地球背景">
        <div class="login-globe"><GlobeScene :interactive="false" /></div>
        <div class="login-visual-caption">
          <span class="eyebrow">GLOBAL IONOSPHERE OBSERVATORY</span>
          <h2>探索电离层 · 守护空间环境</h2>
          <p>全球视野 / 多维分析 / 空间感知</p>
        </div>
      </section>
      <section class="login-panel" aria-labelledby="login-heading">
        <span class="eyebrow">WELCOME TO IONOSPHERE</span>
        <h1 id="login-heading">系统登录</h1>
        <p class="login-panel-intro">登录全球电离层分析系统</p>
        <form class="login-form" @submit.prevent="handleLogin">
          <label for="username">用户名</label>
          <n-input
            v-model:value="loginInfo.username"
            :input-props="{ id: 'username', autocomplete: 'username' }"
            placeholder="请输入用户名"
            :maxlength="20"
            :disabled="loading"
          >
            <template #prefix><icon-mdi-account-outline /></template>
          </n-input>
          <label for="password">密码</label>
          <n-input
            v-model:value="loginInfo.password"
            :input-props="{ id: 'password', autocomplete: 'current-password' }"
            type="password"
            show-password-on="click"
            placeholder="请输入密码"
            :maxlength="128"
            :disabled="loading"
          >
            <template #prefix><icon-mdi-lock-outline /></template>
          </n-input>
          <p v-if="loginError" class="login-error" role="alert">{{ loginError }}</p>
          <n-button
            attr-type="submit"
            type="primary"
            class="login-submit"
            :loading="loading"
            :disabled="loading"
          >
            {{ loading ? '正在登录' : '登 录 系 统'
            }}<template #icon><icon-mdi-chevron-right /></template>
          </n-button>
        </form>
        <div class="login-panel-foot">
          <icon-mdi-lock-outline /><span>授权账户访问 · 统一身份认证</span>
        </div>
        <p v-if="isDevelopment" class="login-dev-hint">本地初始账户：admin / 123456</p>
      </section>
    </main>
    <footer class="login-footer">
      <span>IONOSPHERE 3D</span><span>探索电离层 · 服务通信导航 · 守护空间环境</span>
    </footer>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMediaQuery } from '@vueuse/core'
import { NButton, NInput } from 'naive-ui'
import { lStorage, setToken } from '@/utils'
import api from '@/api'
import { addDynamicRoutes } from '@/router'
import SystemBrand from '@/components/ionosphere/SystemBrand.vue'
import GlobeScene from '@/components/ionosphere/GlobeScene.vue'

const router = useRouter()
const route = useRoute()
const showVisual = useMediaQuery('(min-width: 1001px)')
const isDevelopment = import.meta.env.DEV
const loginInfo = ref({ username: lStorage.get('loginInfo')?.username || '', password: '' })
const loading = ref(false)
const loginError = ref('')
async function handleLogin() {
  if (loading.value) return
  const username = loginInfo.value.username.trim()
  const password = loginInfo.value.password
  if (!username || !password) {
    loginError.value = '请输入用户名和密码。'
    return
  }
  loading.value = true
  loginError.value = ''
  try {
    const res = await api.login({ username, password })
    setToken(res.data.access_token)
    await addDynamicRoutes()
    const redirect = route.query.redirect
    const destination =
      typeof redirect === 'string' && redirect.startsWith('/') && !redirect.startsWith('//')
        ? redirect
        : '/globe'
    await router.replace(destination)
  } catch (error) {
    loginError.value = error.message || '登录失败，请检查账户信息或后端连接。'
  } finally {
    loading.value = false
  }
}
</script>
