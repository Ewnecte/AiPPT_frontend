<script setup lang="ts">
// P07 演示放映页（占位，待前端 C 实现）
</script>

<template>
  <div class="screen">
    <h1>演示放映</h1>
    <p>对应原型 P07。全屏播放、演讲者视图、倒计时、画笔。</p>
    <router-link class="back" to="/editor">← 返回编辑器</router-link>
  </div>
</template>

<style scoped>
.screen {
  background: #0f1220;
  color: #fff;
  border-radius: 14px;
  padding: 40px;
  min-height: 320px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
  justify-content: center;
}
.screen p {
  color: #aab;
}
.back {
  color: #7c8ef0;
  text-decoration: none;
}
</style>
