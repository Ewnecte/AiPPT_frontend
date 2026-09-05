<script setup lang="ts">
// 应用根组件：顶部品牌区 + 步骤流导航 + 路由出口
// 设计规范见 SRS 3.1：紫蓝渐变 #667eea → #764ba2
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
// /screen 放映页等声明 meta.fullscreen 的路由：隐藏顶栏、全幅承载，实现真正全屏
const isFullscreen = computed(() => Boolean(route.meta.fullscreen))
</script>

<template>
  <div class="app" :class="{ fullscreen: isFullscreen }">
    <!-- 全屏路由（放映等）：不带顶栏/内边距，交给子页占满视口 -->
    <div v-if="isFullscreen" class="fullstage">
      <router-view />
    </div>
    <!-- 常规布局：顶部品牌区 + 步骤流导航 -->
    <template v-else>
      <header class="topbar">
        <div class="brand"><span class="logo">P</span> AiPPT</div>
        <nav class="nav">
          <router-link to="/">录入</router-link>
          <router-link to="/ppt">模板</router-link>
          <router-link to="/generate">生成</router-link>
          <router-link to="/editor">编辑器</router-link>
          <router-link to="/screen">放映</router-link>
          <router-link to="/settings">设置</router-link>
        </nav>
      </header>
      <main class="main" :class="{ wide: $route.meta.wide }">
        <router-view />
      </main>
    </template>
  </div>
</template>

<style>
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}
body {
  font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', Roboto, sans-serif;
  background: #eef0f6;
  color: #1f2430;
  -webkit-font-smoothing: antialiased;
}
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  height: 60px;
  padding: 0 28px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #fff;
  box-shadow: 0 4px 20px rgba(102, 126, 234, 0.35);
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 700;
  font-size: 18px;
}
.logo {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.18);
  display: grid;
  place-items: center;
  font-weight: 800;
}
.nav {
  display: flex;
  gap: 6px;
}
.nav a {
  color: rgba(255, 255, 255, 0.85);
  text-decoration: none;
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 14px;
  transition: 0.15s;
}
.nav a:hover {
  background: rgba(255, 255, 255, 0.15);
}
.nav a.router-link-active {
  background: rgba(255, 255, 255, 0.22);
  color: #fff;
  font-weight: 600;
}
.main {
  flex: 1;
  max-width: 1200px;
  width: 100%;
  margin: 0 auto;
  padding: 32px 24px;
}
.main.wide {
  max-width: none;
  padding: 0;
}
.app.fullscreen {
  min-height: 0;
}
.fullstage {
  width: 100%;
  height: 100vh;
  overflow: hidden;
}
</style>
