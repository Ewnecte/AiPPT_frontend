<script setup lang="ts">
// 极简图表渲染：纯 SVG 绘制柱状 / 折线 / 面积 / 饼 / 环，无第三方依赖。
// 坐标基于 1920×1080 画布坐标（由父级缩放），故字号/间距均取画布单位。
import { computed } from 'vue'
import type { ChartItem } from '../types/AIPPT'

const props = defineProps<{
  chart: ChartItem
  w: number
  h: number
}>()

const CHART_COLORS = ['#6366f1', '#0ea5e9', '#ec4899', '#10b981', '#f59e0b', '#8b5cf6', '#14b8a6']

const PAD = { t: 14, r: 16, b: 40, l: 56 }

interface SeriesPt {
  name: string
  data: number[]
}

const cats = computed<string[]>(() => {
  const labels = props.chart.labels ?? []
  if (labels.length) return labels
  const s = seriesOf(props.chart)
  const n = s[0]?.data.length ?? 0
  return Array.from({ length: n }, (_, i) => String(i + 1))
})

function seriesOf(chart: ChartItem): SeriesPt[] {
  const raw = chart.series ?? []
  if (!raw.length) return []
  return raw.map((s) => ({ name: s.name ?? '', data: (s.data ?? []).map((d) => Number(d) || 0) }))
}

const series = computed<SeriesPt[]>(() => seriesOf(props.chart))

const maxVal = computed(() => {
  let m = 0
  for (const s of series.value) for (const v of s.data) m = Math.max(m, v)
  return m || 1
})

const type = computed(() => props.chart.chartType || 'bar')
const isPie = computed(() => type.value === 'pie' || type.value === 'ring')

const total = computed(() => {
  const s = series.value[0]
  return s ? s.data.reduce((a, b) => a + b, 0) : 0
})

/** 条形/折线图：内部绘图区 */
const plot = computed(() => ({
  x0: PAD.l,
  x1: props.w - PAD.r,
  y0: PAD.t,
  y1: props.h - PAD.b,
}))
const plotW = computed(() => Math.max(10, plot.value.x1 - plot.value.x0))
const plotH = computed(() => Math.max(10, plot.value.y1 - plot.value.y0))
const scaleY = computed(() => plotH.value / maxVal.value)

/** 饼 / 环图扇形路径 */
interface PieArc {
  d: string
  color: string
  value: number
  percent: number
}

const pieArcs = computed<PieArc[]>(() => {
  const s = series.value[0]
  if (!s || total.value <= 0) return []
  const cx = props.w / 2
  const cy = props.h / 2
  const r = Math.min(props.w, props.h) / 2 - 8
  const inner = isPie.value ? 0 : r * 0.55
  let acc = 0
  return s.data.map((v, i) => {
    const start = (acc / total.value) * Math.PI * 2 - Math.PI / 2
    acc += v
    const end = (acc / total.value) * Math.PI * 2 - Math.PI / 2
    const large = end - start > Math.PI ? 1 : 0
    const arc = (radius: number, angle: number) => ({
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    })
    const a = arc(r, start)
    const b = arc(r, end)
    const c = arc(inner, end)
    const dd = arc(inner, start)
    const d =
      inner > 0
        ? `M${a.x.toFixed(2)},${a.y.toFixed(2)} A${r},${r} 0 ${large} 1 ${b.x.toFixed(2)},${b.y.toFixed(2)} ` +
          `L${c.x.toFixed(2)},${c.y.toFixed(2)} A${inner},${inner} 0 ${large} 0 ${dd.x.toFixed(2)},${dd.y.toFixed(2)} Z`
        : `M${cx},${cy} L${a.x.toFixed(2)},${a.y.toFixed(2)} A${r},${r} 0 ${large} 1 ${b.x.toFixed(2)},${b.y.toFixed(2)} Z`
    return { d, color: CHART_COLORS[i % CHART_COLORS.length], value: v, percent: total.value ? (v / total.value) * 100 : 0 }
  })
})

const catWidth = computed(() => plotW.value / Math.max(1, cats.value.length))
const barGroupGap = 6
const barWidth = computed(() => {
  const n = Math.max(1, series.value.length)
  const avail = catWidth.value * 0.62 - barGroupGap
  return Math.max(3, avail / n)
})

/** 垂直柱状条（column/bar/area 也统一显示为柱体） */
const bars = computed(() => {
  const out: { x: number; y: number; w: number; h: number; color: string; key: string }[] = []
  series.value.forEach((s, si) => {
    s.data.forEach((v, ci) => {
      const groupX = plot.value.x0 + ci * catWidth.value + catWidth.value * 0.19
      const bw = barWidth.value
      const bx = groupX + si * (bw + barGroupGap)
      const h = v * scaleY.value
      out.push({ x: bx, y: plot.value.y1 - h, w: bw, h, color: CHART_COLORS[si % CHART_COLORS.length], key: `${si}-${ci}` })
    })
  })
  return out
})

/** 折线 / 面积点 */
const linePoints = computed<{ line: string; area: string; points: { x: number; y: number }[] }>(() => {
  const s = series.value[0]
  const none = { line: '', area: '', points: [] }
  if (!s) return none
  const xs = (ci: number) => {
    const n = cats.value.length
    return n <= 1 ? plot.value.x0 + plotW.value / 2 : plot.value.x0 + (ci / (n - 1)) * plotW.value
  }
  const pts = s.data.map((v, ci) => ({ x: xs(ci), y: plot.value.y1 - v * scaleY.value }))
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const area = `${line} L${(pts[pts.length - 1]?.x ?? plot.value.x1).toFixed(1)},${plot.value.y1} L${(pts[0]?.x ?? plot.value.x0).toFixed(1)},${plot.value.y1} Z`
  return { line, area, points: pts }
})

const gridLines = computed(() => {
  const ticks = 4
  const out: { y: number; v: number }[] = []
  for (let i = 0; i <= ticks; i++) {
    const v = (maxVal.value / ticks) * i
    out.push({ y: plot.value.y1 - v * scaleY.value, v })
  }
  return out
})
</script>

<template>
  <div v-if="!cats.length || !series.length" class="empty">（图表数据为空）</div>
  <svg v-else :width="w" :height="h" :viewBox="`0 0 ${w} ${h}`" class="chart">
    <!-- 网格与 Y 轴刻度 -->
    <template v-if="!isPie">
      <g v-for="(g, i) in gridLines" :key="i" class="grid">
        <line :x1="plot.x0" :y1="g.y" :x2="plot.x1" :y2="g.y" />
        <text v-if="i" :x="plot.x0 - 10" :y="g.y + 5" text-anchor="end" class="tick">{{ Math.round(g.v) }}</text>
      </g>
      <!-- 类目刻度 -->
      <text
        v-for="(c, ci) in cats"
        :key="`l-${ci}`"
        :x="plot.x0 + ci * catWidth + catWidth / 2"
        :y="plot.y1 + 22"
        text-anchor="middle"
        class="cate"
      >{{ c }}</text>
    </template>

    <!-- 折线/面积 -->
    <g v-if="!isPie && (type === 'line' || type === 'area' || type === 'radar')">
      <path v-if="type !== 'line'" :d="linePoints.area" fill="currentColor" class="area" />
      <path :d="linePoints.line" fill="none" stroke-width="4" stroke-linecap="round" class="line" />
      <circle v-for="(p, ci) in linePoints.points" :key="`d-${ci}`" :cx="p.x" :cy="p.y" r="6" class="dot" />
    </g>

    <!-- 柱状 -->
    <g v-else-if="!isPie && type !== 'pie'">
      <rect
        v-for="b in bars" :key="b.key" :x="b.x" :y="b.y" :width="b.w" :height="Math.max(1, b.h)"
        :fill="b.color" rx="6"
      />
    </g>

    <!-- 饼 / 环 -->
    <g v-else>
      <path v-for="(a, i) in pieArcs" :key="i" :d="a.d" :fill="a.color" stroke="#fff" stroke-width="3" />
      <text v-if="series[0]" :x="w / 2" :y="h / 2 + 8" text-anchor="middle" class="center-total">{{ Math.round(total) }}</text>
    </g>
  </svg>
</template>

<style scoped>
.empty {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  color: #a0a6ba;
  font-size: 22px;
}
.chart {
  display: block;
}
.grid line {
  stroke: rgba(30, 40, 80, 0.09);
  stroke-width: 2;
}
.tick {
  fill: #8a92a6;
  font-size: 22px;
}
.cate {
  fill: #6b7280;
  font-size: 24px;
}
.area {
  color: #6366f1;
  opacity: 0.14;
}
.line {
  stroke: #6366f1;
}
.dot {
  fill: #4f46e5;
  stroke: #fff;
  stroke-width: 3;
}
.center-total {
  fill: #6366f1;
  font-size: 30px;
  font-weight: 700;
}
</style>
