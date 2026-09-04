<script setup lang="ts">
// 单个元素的纯展示渲染（文本 / 矩形 / 图表）。
// 坐标为 1920×1080 画布单位，由父级负责整体缩放。
// 本组件不监听指针事件，交互由编辑器画布按坐标统一命中处理。
import type { CSSProperties } from 'vue'
import type { SlideElement } from '../types/editor'
import ChartView from './ChartView.vue'

defineProps<{
  el: SlideElement
}>()

function px(n: number): string {
  return `${Math.round(n)}px`
}

function verticalJustify(valign?: 'top' | 'middle' | 'bottom'): string {
  if (valign === 'middle') return 'center'
  if (valign === 'bottom') return 'flex-end'
  return 'flex-start'
}

function outer(el: SlideElement): CSSProperties {
  const base: CSSProperties = {
    position: 'absolute',
    left: px(el.left),
    top: px(el.top),
    width: px(el.width),
    height: px(el.height),
    boxSizing: 'border-box',
    pointerEvents: 'none',
    userSelect: 'none',
    display: el.type === 'rect' ? 'block' : 'block',
  }
  if (el.type === 'rect') {
    base.background = el.bg
    base.borderRadius = px(el.radius)
    if (el.borderColor) base.boxShadow = `inset 0 0 0 3px ${el.borderColor}`
  }
  return base
}

function textInner(el: SlideElement): CSSProperties {
  if (el.type !== 'text') return {}
  const style: CSSProperties = {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: verticalJustify(el.valign),
    textAlign: el.align,
    color: el.color,
    fontSize: px(el.fontSize),
    fontWeight: el.fontWeight ?? 400,
    fontStyle: el.italic ? 'italic' : 'normal',
    lineHeight: el.lineHeight ?? 1.4,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    overflow: 'hidden',
  }
  if (typeof el.letterSpacing === 'number') style.letterSpacing = px(el.letterSpacing)
  return style
}
</script>

<template>
  <div :class="['elv', { 'is-deco': el.decorative }]" :style="outer(el)">
    <div v-if="el.type === 'text'" class="elv-txt" :style="textInner(el)">{{ el.text }}</div>
    <ChartView v-else-if="el.type === 'chart'" :chart="el.chart" :w="el.width" :h="el.height" />
  </div>
</template>

<style scoped>
.elv {
  font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', Roboto, sans-serif;
}
</style>
