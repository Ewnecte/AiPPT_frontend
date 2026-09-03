<script setup lang="ts">
// 单页幻灯片渲染器：按 SlideSchema.type 渲染 16:9 设计稿（基准 1280 x 720）。
// 供 Screen(放映)、演讲者缩略图、导出预览等复用。仅做轻量渲染，
// 完整 PPTist 画布渲染由编辑器部分负责。
import { computed } from 'vue'
import type { SlideSchema, ContentItem } from '../types/AIPPT'

const props = defineProps<{
  slide: SlideSchema
  index?: number
  total?: number
}>()

// 深色渐变背景的页面类型（深底白字）
const DARK_TYPES = new Set(['cover', 'transition', 'end'])

// 处理 body items：字符串与对象统一归一化
interface NormItem {
  title: string
  text: string
  kind: string
  chartType?: string
  url?: string
}

function normItems(items?: (ContentItem | string)[]): NormItem[] {
  if (!items || !items.length) return []
  return items.map((it) => {
    if (typeof it === 'string') return { title: '', text: it, kind: 'bullet' }
    const kind = it.kind ?? 'bullet'
    return {
      title: it.title ?? '',
      text: it.text ?? '',
      kind: kind === 'chart' || kind === 'image' ? kind : 'bullet',
      chartType: it.chartType,
      url: it.url,
    }
  })
}

const items = computed<NormItem[]>(() => normItems(props.slide.data?.items))
const isDark = computed(() => DARK_TYPES.has(props.slide.type))

// content 型页面：是否以卡片网格呈现（含图/表或条目数较多）
const useGrid = computed(() => {
  const arr = items.value
  if (arr.length >= 5) return true
  return arr.some((it) => it.kind !== 'bullet')
})

// cover / end 的副标题或补充说明
const subText = computed(() => props.slide.data?.text ?? '')
const refs = computed(() => props.slide.data?.references ?? [])
</script>

<template>
  <div class="sr" :class="[`sr--${slide.type}`, { 'sr--dark': isDark }]">
    <!-- 页脚页码 -->
    <div class="sr-page" v-if="typeof index === 'number'">
      {{ String((index ?? 0) + 1).padStart(2, '0') }}<span v-if="total"> / {{ total }}</span>
    </div>

    <!-- 封面 -->
    <div v-if="slide.type === 'cover'" class="layer layer--center">
      <div class="sr-kicker">AiPPT · 智能演示</div>
      <h1 class="sr-title cover-title">{{ slide.data?.title || '演示标题' }}</h1>
      <p class="sr-subtitle" v-if="subText">{{ subText }}</p>
    </div>

    <!-- 目录 -->
    <div v-else-if="slide.type === 'contents'" class="layer layer--top">
      <h1 class="headline">目录 / Contents</h1>
      <ol class="contents-list">
        <li v-for="(it, i) in items" :key="i">
          <span class="num">{{ String(i + 1).padStart(2, '0') }}</span>
          <span class="txt">{{ it.text || it.title }}</span>
        </li>
      </ol>
    </div>

    <!-- 章节过渡页 -->
    <div v-else-if="slide.type === 'transition'" class="layer layer--center">
      <h1 class="sr-title trans-title">{{ slide.data?.title || '章节' }}</h1>
    </div>

    <!-- 内容页 -->
    <div v-else-if="slide.type === 'content'" class="layer layer--top">
      <h1 class="headline">{{ slide.data?.title || '内容' }}</h1>
      <p v-if="subText" class="lead">{{ subText }}</p>
      <ul v-if="!useGrid" class="bullet-list">
        <li v-for="(it, i) in items" :key="i">{{ it.text || it.title }}</li>
      </ul>
      <div v-else class="card-grid" :class="{ wide: items.length >= 6 }">
        <div v-for="(it, i) in items" :key="i" class="card" :class="`card--${it.kind}`">
          <template v-if="it.kind === 'chart'">
            <div class="ph ph--chart">
              <span class="ph-icon">📊</span>
              <span class="ph-label">{{ it.chartType || 'chart' }}</span>
            </div>
            <p class="card-title" v-if="it.title">{{ it.title }}</p>
            <p class="card-text" v-if="it.text">{{ it.text }}</p>
          </template>
          <template v-else-if="it.kind === 'image'">
            <div class="ph ph--image"><span class="ph-icon">🖼</span><span class="ph-label">配图</span></div>
            <p class="card-title" v-if="it.title">{{ it.title }}</p>
          </template>
          <template v-else>
            <p class="card-title" v-if="it.title">{{ it.title }}</p>
            <p class="card-text" v-if="it.text">{{ it.text }}</p>
          </template>
        </div>
      </div>
    </div>

    <!-- 参考资料页 -->
    <div v-else-if="slide.type === 'reference'" class="layer layer--top">
      <h1 class="headline">参考资料</h1>
      <ol class="ref-list">
        <li v-for="(r, i) in refs" :key="i">{{ r }}</li>
      </ol>
    </div>

    <!-- 结束页 -->
    <div v-else class="layer layer--center">
      <h1 class="sr-title cover-title">{{ slide.data?.title || '感谢聆听' }}</h1>
      <p v-if="subText" class="sr-subtitle">{{ subText }}</p>
      <p v-if="refs.length" class="ref-foot">参考资料：{{ refs.join('；') }}</p>
    </div>
  </div>
</template>

<style scoped>
/* ===== 基准容器：填满父级（父级负责缩放） ===== */
.sr {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
  background: #ffffff;
  color: #1f2430;
  font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', Roboto, sans-serif;
}
/* 主题配色组 */
.sr--cover { background: linear-gradient(135deg, #1b2a6b 0%, #4f46e5 55%, #7c3aed 100%); color: #fff; }
.sr--transition { background: linear-gradient(135deg, #4f46e5 0%, #9333ea 100%); color: #fff; }
.sr--end { background: linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #334155 100%); color: #fff; }
.sr--contents { background: #fbfcff; color: #1f2430; }
.sr--content { background: #ffffff; color: #1f2430; }
.sr--reference { background: #f7f8fc; color: #1f2430; }

.layer { position: absolute; inset: 0; padding: 72px 96px; }
.layer--center { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 20px; }
.layer--top { padding-top: 64px; overflow: hidden; }

.sr-page {
  position: absolute;
  right: 40px;
  bottom: 28px;
  font-size: 18px;
  letter-spacing: 1px;
  opacity: 0.6;
}
.sr--dark .sr-page { color: #fff; }
.sr:not(.sr--dark) .sr-page { color: #1f2430; }

.sr-kicker {
  font-size: 20px;
  letter-spacing: 4px;
  opacity: 0.8;
  text-transform: uppercase;
  padding: 6px 18px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 999px;
}
.sr-title { margin: 0; }
.cover-title { font-size: 68px; font-weight: 800; line-height: 1.2; max-width: 1000px; }
.trans-title { font-size: 76px; font-weight: 800; letter-spacing: 2px; }
.sr-subtitle { font-size: 26px; opacity: 0.85; max-width: 900px; }

/* 标题行（亮色页共用） */
.headline {
  margin: 0 0 28px;
  font-size: 42px;
  font-weight: 800;
  color: #312e81;
  padding-left: 22px;
  border-left: 10px solid #6366f1;
  line-height: 1.2;
}
.sr--content .headline,
.sr--reference .headline { color: #1f2430; }
.lead { font-size: 22px; color: #475569; margin: -8px 0 22px 32px; }

/* 目录 */
.contents-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px 48px; }
.contents-list li { display: flex; align-items: center; gap: 20px; }
.contents-list .num { font-size: 30px; font-weight: 800; color: #6366f1; font-variant-numeric: tabular-nums; }
.contents-list .txt { font-size: 26px; font-weight: 600; color: #334155; }

/* 要点列表 */
.bullet-list { list-style: none; margin: 16px 0 0; padding: 0 0 0 6px; }
.bullet-list li { position: relative; font-size: 26px; line-height: 1.5; color: #1f2430; padding: 10px 0 10px 34px; }
.bullet-list li::before {
  content: '';
  position: absolute;
  left: 2px;
  top: 24px;
  width: 14px;
  height: 14px;
  border-radius: 4px;
  background: linear-gradient(135deg, #6366f1, #a855f7);
}

/* 卡片网格（含图/表） */
.card-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 24px; margin-top: 10px; }
.card-grid.wide { grid-template-columns: repeat(3, 1fr); }
.card { border: 1px solid #e5e7f0; border-radius: 14px; padding: 18px; background: #fbfcff; box-shadow: 0 6px 18px rgba(31, 45, 91, 0.05); }
.card-title { font-size: 22px; font-weight: 700; margin: 6px 0 4px; color: #1e293b; }
.card-text { font-size: 17px; color: #64748b; margin: 0; line-height: 1.45; }
.ph { height: 120px; border-radius: 10px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; margin-bottom: 8px; }
.ph--chart { background: linear-gradient(135deg, #eef2ff, #f5f3ff); }
.ph--image { background: linear-gradient(135deg, #ecfeff, #e0f2fe); }
.ph-icon { font-size: 34px; }
.ph-label { font-size: 15px; color: #64748b; }

/* 参考资料 */
.ref-list { list-style: none; margin: 8px 0 0; padding: 0; }
.ref-list li { font-size: 24px; line-height: 1.6; color: #334155; padding-left: 30px; position: relative; }
.ref-list li::before { content: '📄'; position: absolute; left: 0; top: 0; }
.ref-foot { font-size: 18px; opacity: 0.7; margin-top: 8px; }
</style>
