<script setup lang="ts">
// 应用根组件：顶部品牌区 + 步骤流导航 + 路由出口
// 设计规范见 SRS 3.1：紫蓝渐变 #667eea → #764ba2
</script>

<template>
  <div class="app">
    <header class="topbar">
      <div class="brand"><span class="logo">P</span> AiPPT</div>
      <nav class="nav">
        <router-link to="/">录入</router-link>
        <router-link to="/outline">大纲</router-link>
        <router-link to="/ppt">模板</router-link>
        <router-link to="/editor">编辑器</router-link>
        <router-link to="/screen">放映</router-link>
        <router-link to="/settings">设置</router-link>
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
