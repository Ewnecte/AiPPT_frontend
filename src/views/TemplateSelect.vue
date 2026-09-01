<script setup lang="ts">
// P03 模板选择页（占位，待前端 A 实现）
import { ref, onMounted } from 'vue'
import { getTemplates } from '../services'
import type { TemplateInfo } from '../types/AIPPT'

const templates = ref<TemplateInfo[]>([])

onMounted(async () => {
  templates.value = await getTemplates()
})
</script>

<template>
  <div class="card">
    <h1>模板选择</h1>
    <p class="hint">对应原型 P03。加载模板卡片、来源选项（网络搜索/上传文件）、生成按钮。</p>
    <p v-if="!templates.length" class="empty">暂未加载到模板（后端 /templates 尚未实现）。</p>
    <div class="grid">
      <div v-for="t in templates" :key="t.id" class="tpl">{{ t.name }}</div>
    </div>
    <router-link class="next" to="/editor">生成后进入编辑器 →</router-link>
  </div>
</template>

<style scoped>
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
.empty {
  color: #b6bcc9;
  font-size: 14px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
  margin: 14px 0;
}
.tpl {
  aspect-ratio: 16/9;
  border: 1px solid #e6e8ef;
  border-radius: 10px;
  display: grid;
  place-items: center;
  color: #4b5563;
  font-size: 14px;
}
.next {
  color: #3b82f6;
  text-decoration: none;
  font-size: 14px;
}
</style>
