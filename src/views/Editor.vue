<script setup lang="ts">
// P05 幻灯片编辑器（占位，待前端 B 集成 PPTist）
import { useSlidesStore } from '../store/slides'
import StepBar from '../components/StepBar.vue'

const store = useSlidesStore()
</script>

<template>
  <section class="page">
    <StepBar :current="4" />
    <div class="card">
      <h1>幻灯片编辑器</h1>
      <p class="hint">对应原型 P05。此处需集成 PPTist 编辑器（缩略图栏 + 画布 + 工具栏 + 样式面板）。</p>
      <p class="stat">当前已生成 {{ store.slides.length }} 页幻灯片。</p>
      <router-link class="next" to="/screen">去放映 →</router-link>
    </div>
  </section>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.card {
  background: #fff;
  border-radius: 14px;
  padding: 28px;
  box-shadow: 0 10px 30px rgba(30, 40, 80, 0.08);
}
h1 {
  font-size: 22px;
}
.hint {
  color: #8a94a6;
  font-size: 13px;
  margin: 6px 0 18px;
}
.stat {
  font-size: 15px;
  color: #4b5563;
}
.next {
  color: #3b82f6;
  text-decoration: none;
  font-size: 14px;
}
</style>
