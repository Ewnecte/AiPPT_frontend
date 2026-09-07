<script setup lang="ts">
// 应用根组件：顶部品牌区 + 步骤流导航 + 路由出口
// 设计规范见 SRS 3.1：紫蓝渐变 #667eea → #764ba2
import { onMounted, onUnmounted } from 'vue'
import { useGenerationStore } from './store/generation'

const gen = useGenerationStore()

// 生成中(busy)刷新或关闭标签会直接丢失流式结果，用原生事件兜底弹「离开确认」。
function onBeforeUnload(e: BeforeUnloadEvent) {
  if (!gen.busy) return
  e.preventDefault()
  e.returnValue = '' // 触发浏览器原生离开确认框
}
onMounted(() => window.addEventListener('beforeunload', onBeforeUnload))
onUnmounted(() => window.removeEventListener('beforeunload', onBeforeUnload))
</script>

<template>
  <div class="app">
    <header class="topbar">
      <div class="brand"><span class="logo">P</span> AiPPT</div>
      <nav class="nav">
        <span v-if="gen.busy" class="lockchip" title="大纲正在流式生成，请勿切换或关闭页面">🔒 生成中</span>
        <router-link to="/" :class="{ locked: gen.busy }">录入</router-link>
        <router-link to="/outline" :class="{ locked: gen.busy }">大纲</router-link>
        <router-link to="/ppt" :class="{ locked: gen.busy }">模板</router-link>
        <router-link to="/editor" :class="{ locked: gen.busy }">编辑器</router-link>
        <router-link to="/screen" :class="{ locked: gen.busy }">放映</router-link>
        <router-link to="/settings" :class="{ locked: gen.busy }">设置</router-link>
      </nav>
    </header>
    <main class="main">
      <div class="container">
        <router-view />
      </div>
    </main>
  </div>
</template>

<style>
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}
html,
body {
  height: 100%;
  overflow: hidden; /* 整页不再滚动：滚动收敛到下方内容区 .main */
}
body {
  font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', Roboto, sans-serif;
  background: #eef0f6;
  color: #1f2430;
  -webkit-font-smoothing: antialiased;
}
.app {
  height: 100vh;
  height: 100dvh; /* 移动端地址栏收起时仍铺满 */
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.topbar {
  flex: 0 0 auto; /* 固定高度，不参与内容滚动 */
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
/* 生成中锁态：链接灰化且不可点击（路由守卫另有兜底，防后退/直达） */
.nav a.locked {
  opacity: 0.45;
  pointer-events: none;
}
.lockchip {
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  padding: 5px 10px;
  border-radius: 999px;
  white-space: nowrap;
  margin-right: 2px;
}
.nav a.router-link-active {
  background: rgba(255, 255, 255, 0.22);
  color: #fff;
  font-weight: 600;
}
/* 唯一的垂直滚动容器：占满顶栏以下的剩余高度 */
.main {
  flex: 1;
  min-height: 0; /* 允许收缩到剩余高度，内容超高时在内部滚动 */
  width: 100%;
  overflow-y: auto;
  overflow-x: hidden;
}
.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 32px 24px;
}
</style>
