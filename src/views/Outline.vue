<script setup lang="ts">
// P01/P02 录入 + 大纲生成页（示例：已接通 AIPPT_Outline 流式）
import { ref } from 'vue'
import { AIPPT_Outline } from '../services'

const content = ref('')
const output = ref('')
const loading = ref(false)

async function generate() {
  if (!content.value.trim() || loading.value) return
  loading.value = true
  output.value = ''
  try {
    await AIPPT_Outline(content.value, '中文', 'qwen-turbo-latest', (chunk) => {
      output.value += chunk
    })
  } catch (e) {
    output.value = `生成失败：${(e as Error).message}`
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="card">
    <h1>主题录入 / 大纲生成</h1>
    <p class="hint">对应原型 P01 / P02，完整 UI（语言选择、推荐主题气泡、大纲树编辑）见《复现实施计划》第 9 节。</p>
    <textarea v-model="content" placeholder="输入演示主题或粘贴文档内容…" rows="5"></textarea>
    <button class="btn" :disabled="loading" @click="generate">
      {{ loading ? '生成中…' : '✨ AI 生成大纲' }}
    </button>
    <router-link class="next" to="/ppt">下一步：选择模板 →</router-link>
    <pre v-if="output" class="out">{{ output }}</pre>
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
textarea {
  width: 100%;
  border: 1px solid #e6e8ef;
  border-radius: 10px;
  padding: 12px;
  font-size: 15px;
  font-family: inherit;
  resize: vertical;
  outline: none;
}
textarea:focus {
  border-color: #3b82f6;
}
.btn {
  margin-top: 14px;
  border: none;
  cursor: pointer;
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  padding: 10px 22px;
  border-radius: 10px;
}
.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.next {
  display: inline-block;
  margin: 14px 0 0 12px;
  color: #3b82f6;
  text-decoration: none;
  font-size: 14px;
}
.out {
  margin-top: 18px;
  padding: 14px;
  background: #f7f8fc;
  border-radius: 10px;
  white-space: pre-wrap;
  font-size: 14px;
  min-height: 60px;
}
</style>
