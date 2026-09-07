<script setup lang="ts">
// 统一四步步骤条：大纲生成 → 大纲编辑 → 选择模板 → PPT生成
// ------------------------------------------------------------------
// 所有向导页共用同一组件与同一份样式（步骤文案 / 完成态 / 当前态统一）。
//   current: 当前页所在的步骤序号（1-4），该步骤高亮为「当前」。
//   done:    已完成步骤数；不传时默认 current - 1（本步未完成），
//            传入 >= current 可在最后一步完成后把当前步也标为 ✓。
// 已完成步骤可点击回退（router-link），未到达的步骤不可点击。
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    current: number
    done?: number
  }>(),
  { done: 0 },
)

interface StepItem {
  n: number
  label: string
  to: string
}

const STEPS: StepItem[] = [
  { n: 1, label: '大纲生成', to: '/' },
  { n: 2, label: '大纲编辑', to: '/outline' },
  { n: 3, label: '选择模板', to: '/ppt' },
  { n: 4, label: 'PPT生成', to: '/generate' },
]

const doneCount = computed(() => (props.done > 0 ? props.done : Math.max(0, props.current - 1)))

function isDone(s: StepItem): boolean {
  return s.n <= doneCount.value
}

function isCurrent(s: StepItem): boolean {
  return s.n === props.current
}
</script>

<template>
  <nav class="stepbar" aria-label="生成步骤">
    <template v-for="(s, i) in STEPS" :key="s.n">
      <!-- 连接线：左侧步骤已完成时点亮 -->
      <span v-if="i > 0" class="line" :class="{ on: isDone(STEPS[i - 1]) }"></span>

      <router-link v-if="isDone(s)" :to="s.to" class="step done" :class="{ active: isCurrent(s) }">
        <i>✓</i><span>{{ s.label }}</span>
      </router-link>
      <div v-else-if="isCurrent(s)" class="step active">
        <i>{{ s.n }}</i><span>{{ s.label }}</span>
      </div>
      <div v-else class="step">
        <i>{{ s.n }}</i><span>{{ s.label }}</span>
      </div>
    </template>
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
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #8a94a6;
  text-decoration: none;
  white-space: nowrap;
  font-weight: 500;
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
  flex: none;
  transition: 0.15s;
}
/* 已完成（可回退） */
.step.done {
  color: #1f2430;
  cursor: pointer;
}
.step.done i {
  background: #10b981;
  box-shadow: 0 2px 6px rgba(16, 185, 129, 0.35);
}
.step.done:hover i {
  transform: scale(1.12);
}
/* 当前步骤 */
.step.active {
  color: #1f2430;
  font-weight: 700;
}
.step.active:not(.done) i {
  background: linear-gradient(135deg, #667eea, #764ba2);
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.45);
}
/* 当前步骤恰好也是最后一步完成态 */
.step.done.active {
  color: #4338ca;
}
.step.done.active i {
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.28);
}
/* 连接线 */
.line {
  width: 44px;
  height: 2px;
  border-radius: 2px;
  background: #e2e6f0;
  flex: none;
}
.line.on {
  background: linear-gradient(90deg, #34d399, #10b981);
}
@media (max-width: 640px) {
  .stepbar {
    gap: 6px;
  }
  .line {
    width: 18px;
  }
}
</style>
