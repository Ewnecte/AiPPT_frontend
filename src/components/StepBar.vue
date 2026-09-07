<script setup lang="ts">
// 全流程步骤条：主题录入 → 大纲编辑 → 选择模板 → 编辑器 → 放映
// 用于向导页顶部导航。current 传当前步骤(1..5)；当前步骤高亮不可点，其余可跳转。
// 「知识库/设置」不属于生成流程，作为右侧独立入口附在末尾。
import { defineProps } from 'vue'
import { useGenerationStore } from '../store/generation'

const gen = useGenerationStore()
defineProps<{ current: number }>()

const STEPS = [
  { n: 1, label: '主题录入', to: '/' },
  { n: 2, label: '大纲编辑', to: '/outline' },
  { n: 3, label: '选择模板', to: '/ppt' },
  { n: 4, label: '编辑器', to: '/editor' },
  { n: 5, label: '放映', to: '/screen' },
]
</script>

<template>
  <nav class="stepbar">
    <template v-for="(s, i) in STEPS" :key="s.to">
      <router-link v-if="s.n !== current" class="step" :class="{ locked: gen.busy }" :to="s.to">
        <i>{{ s.n }}</i> {{ s.label }}
      </router-link>
      <span v-else class="step active"><i>{{ s.n }}</i> {{ s.label }}</span>
      <span v-if="i < STEPS.length - 1" class="line"></span>
    </template>
    <span class="divider"></span>
    <router-link class="step tool" :class="{ locked: gen.busy }" to="/settings" title="知识库 / 系统设置">⚙ 设置</router-link>
  </nav>
</template>

<style scoped>
.stepbar {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 10px;
  row-gap: 8px;
  color: #8a94a6;
  font-size: 13px;
}
.step {
  display: flex;
  align-items: center;
  gap: 6px;
  text-decoration: none;
  color: inherit;
  transition: color 0.15s;
}
a.step:hover {
  color: #4f46e5;
}
a.step.locked {
  pointer-events: none;
  opacity: 0.45;
}
a.step.locked:hover {
  color: inherit;
}
.step i {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #dfe3ee;
  color: #fff;
  font-style: normal;
  font-weight: 700;
  font-size: 12px;
  display: grid;
  place-items: center;
}
.step.active {
  color: #1f2430;
  font-weight: 600;
}
.step.active i {
  background: linear-gradient(135deg, #667eea, #764ba2);
}
.line {
  width: 40px;
  height: 2px;
  background: #dfe3ee;
  border-radius: 2px;
  flex: 0 0 auto;
}
.divider {
  width: 1px;
  height: 16px;
  background: #d9dde9;
  margin: 0 6px;
}
a.step.tool:hover {
  color: #4f46e5;
}
</style>
