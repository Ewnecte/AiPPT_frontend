<script setup lang="ts">
// P05 幻灯片编辑器（元素级，轻量版）
// ------------------------------------------------------------------
// 1920×1080 逻辑画布；元素直接以绝对定位绘制在 scale 缩放的舞台里，
// 命中测试按逻辑坐标手动完成（元素层 pointer-events:none），
// 选中框/缩放手柄/文本输入悬浮在“屏幕坐标”层，保证任意缩放下清晰可用。
//  - 单击选中 / 拖拽移动 / 八向手柄缩放 / 双击文本就地编辑
//  - 元素文本带 ref 的会实时同步回 SlideSchema
//  - 右侧面板：文本样式 / 形状 / 图表 / 页面背景与主色
//  - 撤销/重做、缩放、导出导入 JSON、页面增删复制排序
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useSlidesStore } from '../store/slides'
import type { ChartItem, SlideType } from '../types/AIPPT'
import type { ChartEl, EditorSlide, RectEl, SlideElement, TextEl } from '../types/editor'
import { SLIDE_W, SLIDE_H } from '../types/editor'
import ElementView from '../components/ElementView.vue'
import SlideViewer from '../components/SlideViewer.vue'
import {
  ACCENTS,
  BACKGROUND_PRESETS,
  SLIDE_TYPES,
  SLIDE_TYPE_LABELS,
  demoDeck,
  uid,
} from '../utils/aippt'

const store = useSlidesStore()
const router = useRouter()

const scale = ref(0.5)
const canvasEl = ref<HTMLElement | null>(null)
const selectedId = ref<string | null>(null)
const hoverId = ref<string | null>(null)
const insertOpen = ref(false)

// 就地文本编辑
const editingId = ref<string | null>(null)
const editingText = ref('')
const editEl = ref<HTMLTextAreaElement | null>(null)
let editingChanged = false

// 历史记录的“脏”标记：一次连续操作只记一条快照
let dirty = false
function armRecord() {
  dirty = false
}

const slideIdx = computed(() => store.currentIndex)
const slide = computed<EditorSlide | null>(() => store.currentSlide)
const total = computed(() => store.slideCount)

const selected = computed<SlideElement | null>(() =>
  selectedId.value ? store.findElement(slideIdx.value, selectedId.value) : null,
)
const selText = computed<TextEl | null>(() =>
  selected.value?.type === 'text' ? (selected.value as TextEl) : null,
)
const selRect = computed<RectEl | null>(() =>
  selected.value?.type === 'rect' ? (selected.value as RectEl) : null,
)
const selChart = computed<ChartEl | null>(() =>
  selected.value?.type === 'chart' ? (selected.value as ChartEl) : null,
)
const editingEl = computed<TextEl | null>(() =>
  editingId.value ? (store.findElement(slideIdx.value, editingId.value) as TextEl | null) : null,
)

// 只读悬浮预览（图表元素不显示描边，让内容清晰）
const hoverGeom = computed(() => {
  const el = hoverId.value ? store.findElement(slideIdx.value, hoverId.value) : null
  return el && el.type !== 'chart' ? el : null
})
const selGeom = computed<SlideElement | null>(() => selected.value)

// ------------------------------------------------------------------
// 命中测试
// ------------------------------------------------------------------
function hitAt(x: number, y: number, skipLock: boolean): SlideElement | null {
  const s = slide.value
  if (!s) return null
  for (let i = s.elements.length - 1; i >= 0; i--) {
    const el = s.elements[i]
    if (el.lock && skipLock) continue
    if (x >= el.left && x <= el.left + el.width && y >= el.top && y <= el.top + el.height) {
      return el
    }
  }
  return null
}
function selectAt(x: number, y: number): SlideElement | null {
  return hitAt(x, y, false)
}

function logicalFromEvent(e: MouseEvent | PointerEvent): { x: number; y: number } {
  const stage = canvasEl.value?.querySelector('.stage') as HTMLElement | null
  if (!stage) return { x: -1, y: -1 }
  const rect = stage.getBoundingClientRect()
  return { x: (e.clientX - rect.left) / scale.value, y: (e.clientY - rect.top) / scale.value }
}

function toLogical(e: PointerEvent): { x: number; y: number } {
  return logicalFromEvent(e)
}

// ------------------------------------------------------------------
// 文本就地编辑
// ------------------------------------------------------------------
function beginEdit(el: SlideElement) {
  if (el.type !== 'text' || el.lock) return
  if (editingId.value) finishEdit()
  store.record()
  armRecord()
  selectedId.value = el.id
  editingId.value = el.id
  editingText.value = el.text
  editingChanged = false
  nextTick(() => {
    const ta = editEl.value
    if (ta) {
      ta.focus()
      ta.setSelectionRange(ta.value.length, ta.value.length)
    }
  })
}

function finishEdit() {
  if (editingId.value !== null) {
    editingId.value = null
    editingChanged = false
  }
}

function onEditInput() {
  const id = editingId.value
  if (!id) return
  editingChanged = true
  store.setText(slideIdx.value, id, editingText.value)
}

function commitEdit() {
  finishEdit()
}
function cancelEdit() {
  const id = editingId.value
  if (id !== null) {
    if (editingChanged) {
      // 撤销到编辑前快照
      store.undo()
      // 丢弃刚被顶进 future 的“编辑后”状态，避免 Ctrl+Y 找回已取消的内容
      if (store.future.length) store.future.pop()
    }
    editingId.value = null
    editingChanged = false
  }
}
function onEditKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    cancelEdit()
  } else if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    commitEdit()
    editEl.value?.blur()
  }
}

// ------------------------------------------------------------------
// 拖拽：移动 / 缩放
// ------------------------------------------------------------------
type ResizeDir = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
const DIRS: ResizeDir[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const DIR_CURSOR: Record<ResizeDir, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
}
interface DragState {
  kind: 'move' | 'resize'
  dir?: ResizeDir
  id: string
  startX: number
  startY: number
  base: { left: number; top: number; width: number; height: number }
  started: boolean
}
const drag = ref<DragState | null>(null)

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), Math.max(lo, hi))
}

function onStagePointerDown(e: PointerEvent) {
  if (e.button !== 0) return
  if (editingEl.value) {
    commitEdit()
    return
  }
  const { x, y } = toLogical(e)
  const el = hitAt(x, y, true)
  if (el) {
    selectedId.value = el.id
    armRecord()
    drag.value = {
      kind: 'move',
      id: el.id,
      startX: e.clientX,
      startY: e.clientY,
      base: { left: el.left, top: el.top, width: el.width, height: el.height },
      started: false,
    }
  } else {
    selectedId.value = null
  }
}

function onWindowMove(e: PointerEvent) {
  // hover 反馈（非拖拽时）
  if (!drag.value) {
    const { x, y } = logicalFromEvent(e)
    hoverId.value = hitAt(x, y, false)?.id ?? null
    return
  }
  const d = drag.value
  if (!canvasEl.value) return
  e.preventDefault()
  const dx = (e.clientX - d.startX) / scale.value
  const dy = (e.clientY - d.startY) / scale.value
  if (!d.started && Math.abs(dx) + Math.abs(dy) < 1) return
  const el = store.findElement(slideIdx.value, d.id)
  if (!el) return

  if (!d.started) {
    store.record()
    armRecord()
    d.started = true
  }

  if (d.kind === 'move') {
    el.left = Math.round(clamp(d.base.left + dx, 0, SLIDE_W - el.width))
    el.top = Math.round(clamp(d.base.top + dy, 0, SLIDE_H - el.height))
    return
  }

  const dir = d.dir!
  let L = d.base.left
  let T = d.base.top
  let W = d.base.width
  let H = d.base.height
  if (dir.includes('e')) W = clamp(d.base.width + dx, 24, SLIDE_W - d.base.left)
  if (dir.includes('s')) H = clamp(d.base.height + dy, 16, SLIDE_H - d.base.top)
  if (dir.includes('w')) {
    const nl = clamp(d.base.left + dx, 0, d.base.left + d.base.width - 24)
    W = d.base.width + d.base.left - nl
    L = nl
  }
  if (dir.includes('n')) {
    const nt = clamp(d.base.top + dy, 0, d.base.top + d.base.height - 16)
    H = d.base.height + d.base.top - nt
    T = nt
  }
  el.left = Math.round(L)
  el.top = Math.round(T)
  el.width = Math.round(W)
  el.height = Math.round(H)
}

function endDrag() {
  if (drag.value) {
    if (drag.value.kind === 'move' && drag.value.started) {
      const el = store.findElement(slideIdx.value, drag.value.id)
      if (el) selectedId.value = el.id
    }
    drag.value = null
  }
}

function beginResize(dir: ResizeDir, e: PointerEvent) {
  e.stopPropagation()
  e.preventDefault()
  const el = selected.value
  if (!el || el.lock) return
  if (editingEl.value) commitEdit()
  store.record()
  armRecord()
  drag.value = {
    kind: 'resize',
    dir,
    id: el.id,
    startX: e.clientX,
    startY: e.clientY,
    base: { left: el.left, top: el.top, width: el.width, height: el.height },
    started: true,
  }
}

function onStageDouble(e: MouseEvent) {
  const { x, y } = logicalFromEvent(e)
  const el = selectAt(x, y)
  if (el && el.type === 'text' && el.id !== editingId.value) beginEdit(el)
}

// ------------------------------------------------------------------
// 快捷创建元素
// ------------------------------------------------------------------
function addElement(el: SlideElement) {
  if (!slide.value) return
  store.record()
  store.addElement(slideIdx.value, el)
  armRecord()
  selectedId.value = el.id
}
function makeText(): TextEl {
  const s = slide.value
  return {
    id: uid(),
    type: 'text',
    left: 620,
    top: 400,
    width: 680,
    height: 120,
    text: '双击编辑文本',
    fontSize: 44,
    fontWeight: 700,
    color: s?.background.dark ? '#ffffff' : '#1f2340',
    align: 'center',
    valign: 'middle',
    lineHeight: 1.3,
  }
}
function makeRect(): SlideElement {
  const accent = slide.value?.accent ?? '#6366f1'
  return {
    id: uid(),
    type: 'rect',
    left: 620,
    top: 320,
    width: 680,
    height: 240,
    bg: accent + '22',
    radius: 16,
    borderColor: accent,
  }
}
function chartItem(): ChartItem {
  return {
    kind: 'chart',
    title: '示例图表',
    text: '',
    chartType: 'bar',
    labels: ['Q1', 'Q2', 'Q3', 'Q4'],
    series: [
      { name: 'A', data: [40, 62, 78, 95] },
      { name: 'B', data: [30, 45, 52, 68] },
    ],
  }
}
function makeChart(): SlideElement {
  return {
    id: uid(),
    type: 'chart',
    left: 560,
    top: 240,
    width: 800,
    height: 520,
    chart: chartItem(),
  }
}
function addText() {
  addElement(makeText())
}
function addRect() {
  addElement(makeRect())
}
function addChart() {
  addElement(makeChart())
}

// ------------------------------------------------------------------
// 属性面板（每次连续输入记一条历史）
// ------------------------------------------------------------------
function markDirty() {
  if (!dirty) {
    store.record()
    armRecord()
    dirty = true
  }
}
function setTextProps(patch: Partial<TextEl>) {
  const el = selText.value
  if (!el) return
  markDirty()
  Object.assign(el, patch)
}
function setTextContent(v: string) {
  const el = selText.value
  if (!el) return
  markDirty()
  el.text = v
  syncTextToSchema()
}
function syncTextToSchema() {
  const s = slide.value
  if (!s) return
  // 把文本元素内容写回 schema（ref 存在时）
  const d = s.schema.data || (s.schema.data = {})
  for (const el of s.elements) {
    if (el.type !== 'text' || !el.ref || el.decorative) continue
    const seg = el.ref.split('.')
    if (seg.length === 1 && seg[0] === 'title') d.title = el.text
    else if (seg.length === 1 && seg[0] === 'text') d.text = el.text
    else if (seg.length === 2 && seg[0] === 'items' && d.items) {
      const idx = Number(seg[1])
      const it = d.items[idx]
      if (typeof it === 'string') d.items[idx] = el.text
      else if (it) it.title = el.text
    } else if (seg.length === 3 && seg[0] === 'items' && d.items) {
      const idx = Number(seg[1])
      const it = d.items[idx]
      if (it && typeof it === 'object' && seg[2] === 'text') it.text = el.text
    } else if (seg.length === 2 && seg[0] === 'references' && d.references) {
      d.references[Number(seg[1])] = el.text
    }
  }
}
function setRectProps(patch: Partial<RectEl>) {
  const el = selRect.value
  if (!el) return
  markDirty()
  Object.assign(el, patch)
}
function setChartType(t: ChartItem['chartType']) {
  const el = selChart.value
  if (!el || el.type !== 'chart') return
  markDirty()
  el.chart = { ...el.chart, chartType: t }
}
function deleteSelected() {
  const id = selectedId.value
  if (!id) return
  store.record()
  store.removeElement(slideIdx.value, id)
  selectedId.value = null
}
function toggleLock() {
  const el = selected.value
  if (!el) return
  store.record()
  el.lock = !el.lock
  if (el.lock) selectedId.value = null
}
function layer(dir: 'front' | 'back') {
  const id = selectedId.value
  if (!id) return
  store.record()
  if (dir === 'front') store.bringElementForward(slideIdx.value, id)
  else store.sendElementBackward(slideIdx.value, id)
}

// ------------------------------------------------------------------
// 页面级操作
// ------------------------------------------------------------------
function addBlank(type: SlideType) {
  store.record()
  store.insertBlank(type)
  selectedId.value = null
  insertOpen.value = false
}
function dupCurrent() {
  store.record()
  store.duplicateSlide(slideIdx.value)
  selectedId.value = null
}
function delCurrent() {
  if (total.value <= 1) return
  finishEdit()
  store.record()
  store.removeSlide(slideIdx.value)
  selectedId.value = null
}
function setCurrent(i: number) {
  finishEdit()
  store.setCurrent(i)
  selectedId.value = null
}
function moveCurrent(delta: number) {
  finishEdit()
  store.record()
  store.moveSlide(slideIdx.value, slideIdx.value + delta)
  selectedId.value = null
}
/** 缩略图栏：上移/下移指定序号的页面（记录历史） */
function railMove(i: number, delta: number) {
  const target = i + delta
  if (target < 0 || target >= total.value) return
  finishEdit()
  store.record()
  store.moveSlide(i, target)
  selectedId.value = null
}
/** 缩略图栏：复制指定序号的页面 */
function railDup(i: number) {
  finishEdit()
  store.record()
  store.duplicateSlide(i)
  selectedId.value = null
}
/** 缩略图栏：删除指定序号的页面 */
function railDel(i: number) {
  if (total.value <= 1) return
  finishEdit()
  store.record()
  store.removeSlide(i)
  selectedId.value = null
}
function relayout() {
  finishEdit()
  store.record()
  store.relayoutSlide(slideIdx.value)
  selectedId.value = null
}
function setAccent(c: string) {
  const s = slide.value
  if (!s) return
  store.record()
  s.accent = c
}
function setBackground(idx: number) {
  const s = slide.value
  if (!s) return
  const p = BACKGROUND_PRESETS[idx]
  if (!p) return
  store.record()
  s.background = { ...p.bg }
}
function setBgCss(v: string) {
  const s = slide.value
  if (!s) return
  store.record()
  s.background = { ...s.background, css: v }
}

// ------------------------------------------------------------------
// 撤销 / 重做 / 缩放 / 快捷键
// ------------------------------------------------------------------
function undo() {
  if (editingEl.value) finishEdit()
  if (store.undo()) {
    selectedId.value = null
    armRecord()
  }
}
function redo() {
  if (editingEl.value) finishEdit()
  if (store.redo()) {
    selectedId.value = null
    armRecord()
  }
}
function zoom(f: number) {
  scale.value = clamp(scale.value * f, 0.1, 3)
}
function fit() {
  const el = canvasEl.value
  if (!el) return
  const w = el.clientWidth - 48
  const h = el.clientHeight - 48
  scale.value = clamp(Math.min(w / SLIDE_W, h / SLIDE_H), 0.1, 1)
}
const zoomLabel = computed(() => `${Math.round(scale.value * 100)}%`)

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
}
function onKeydown(e: KeyboardEvent) {
  if (isTyping(e)) return
  const mod = e.metaKey || e.ctrlKey
  const k = e.key.toLowerCase()
  if (mod && k === 'z') {
    e.preventDefault()
    if (e.shiftKey) redo()
    else undo()
    return
  }
  if (mod && k === 'y') {
    e.preventDefault()
    redo()
    return
  }
  if (mod && k === 'd') {
    e.preventDefault()
    dupCurrent()
    return
  }
  if (mod && k === 's') {
    e.preventDefault()
    exportJSON()
    return
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId.value) {
    e.preventDefault()
    deleteSelected()
    return
  }
  const id = selectedId.value
  if (!id) return
  const el = store.findElement(slideIdx.value, id)
  if (!el || el.lock) return
  const step = e.shiftKey ? 20 : 2
  let dx = 0
  let dy = 0
  if (e.key === 'ArrowUp') dy = -step
  else if (e.key === 'ArrowDown') dy = step
  else if (e.key === 'ArrowLeft') dx = -step
  else if (e.key === 'ArrowRight') dx = step
  else return
  e.preventDefault()
  markDirty()
  el.left = clamp(el.left + dx, 0, SLIDE_W - el.width)
  el.top = clamp(el.top + dy, 0, SLIDE_H - el.height)
}

// ------------------------------------------------------------------
// 导出 / 导入
// ------------------------------------------------------------------
function exportJSON() {
  const schemas = store.exportSchemas()
  const blob = new Blob([JSON.stringify(schemas, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${store.meta.title || 'slides'}.json`
  a.click()
  URL.revokeObjectURL(url)
}
function importFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result))
      if (Array.isArray(data)) {
        store.record()
        store.importSchemas(data)
        selectedId.value = null
      } else {
        window.alert('JSON 格式不正确：应为 SlideSchema[]')
      }
    } catch {
      window.alert('解析 JSON 失败')
    }
  }
  reader.readAsText(file)
  input.value = ''
}

function goScreen() {
  router.push('/screen')
}
function loadDemo() {
  store.seedSlides(demoDeck())
}
function goGenerate() {
  router.push('/generate')
}

// 计算属性：舞台 / 几何（CSS 值）
const stageStyle = computed(() => {
  const s = slide.value
  return {
    width: SLIDE_W + 'px',
    height: SLIDE_H + 'px',
    transform: `scale(${scale.value})`,
    background: s ? s.background.css : '#ffffff',
  }
})
function elCss(el: SlideElement | null): Record<string, string> {
  if (!el) return { display: 'none' }
  const k = scale.value
  return {
    left: el.left * k + 'px',
    top: el.top * k + 'px',
    width: el.width * k + 'px',
    height: el.height * k + 'px',
  }
}
const editingCss = computed(() => {
  const el = editingEl.value
  if (!el) return {}
  const k = scale.value
  return {
    left: el.left * k + 'px',
    top: el.top * k + 'px',
    width: el.width * k + 'px',
    height: el.height * k + 'px',
    fontSize: Math.max(12, el.fontSize * k) + 'px',
    lineHeight: (el.lineHeight ?? 1.4) + '',
    textAlign: el.align,
    color: el.color,
    fontStyle: el.italic ? 'italic' : 'normal',
    fontWeight: el.fontWeight ?? 400,
  }
})

// ------------------------------------------------------------------
// 生命周期 / 全局监听
// ------------------------------------------------------------------
watch(selectedId, () => armRecord())
watch(slide, () => {
  selectedId.value = null
  finishEdit()
  armRecord()
})

onMounted(() => {
  window.addEventListener('pointermove', onWindowMove)
  window.addEventListener('pointerup', endDrag)
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', fit)
  nextTick(fit)
})
onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onWindowMove)
  window.removeEventListener('pointerup', endDrag)
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', fit)
})
</script>

<template>
  <div class="editor">
    <template v-if="slide">
      <!-- 顶部工具栏 -->
      <div class="toolbar">
        <div class="tb-group left">
          <button class="tb-btn" title="撤销 (Ctrl+Z)" :disabled="!store.canUndo" @click="undo">↩</button>
          <button class="tb-btn" title="重做 (Ctrl+Y)" :disabled="!store.canRedo" @click="redo">↪</button>
          <span class="divider" />
          <button class="tb-btn" title="缩小" @click="zoom(1 / 1.25)">−</button>
          <span class="zoom-label">{{ zoomLabel }}</span>
          <button class="tb-btn" title="放大" @click="zoom(1.25)">＋</button>
          <button class="tb-btn" title="适应窗口" @click="fit">⤢</button>
        </div>

        <div class="tb-group mid">
          <button class="tb-btn accent" @click="addText">＋ 文本</button>
          <button class="tb-btn accent" @click="addRect">＋ 形状</button>
          <button class="tb-btn accent" @click="addChart">＋ 图表</button>
        </div>

        <div class="tb-group right">
          <span class="page-no">{{ slideIdx + 1 }} / {{ total }}</span>
          <span class="chip">{{ SLIDE_TYPE_LABELS[slide.type] }}</span>
          <span class="divider" />
          <button class="tb-btn" title="重新排版（按内容重建版式）" @click="relayout">⟳ 排版</button>
          <button class="tb-btn" title="复制本页 (Ctrl+D)" @click="dupCurrent">⧉ 复制</button>
          <button class="tb-btn" title="删除本页" :disabled="total <= 1" @click="delCurrent">🗑</button>
          <span class="divider" />
          <button class="tb-btn" title="导出 JSON (Ctrl+S)" @click="exportJSON">⇩ 导出</button>
          <label class="tb-btn" title="导入 JSON">⇧ 导入
            <input type="file" accept="application/json,.json" style="display: none" @change="importFile" />
          </label>
          <button class="tb-btn play" @click="goScreen">▶ 放映</button>
        </div>
      </div>

      <!-- 主体三栏 -->
      <div class="body">
        <!-- 左：缩略图栏 -->
        <aside class="rail">
          <div class="rail-head">
            <span>页面</span>
            <button class="icon-btn" title="插入页面" @click="insertOpen = !insertOpen">＋</button>
          </div>
          <div v-if="insertOpen" class="insert-menu">
            <button v-for="t in SLIDE_TYPES" :key="t" class="insert-item" @click="addBlank(t)">
              ＋ {{ SLIDE_TYPE_LABELS[t] }}
            </button>
          </div>
          <div class="thumbs">
            <div
              v-for="(s, i) in store.slides"
              :key="s.id"
              class="thumb"
              :class="{ active: i === slideIdx }"
              @click="setCurrent(i)"
            >
              <span class="thumb-no">{{ i + 1 }}</span>
              <SlideViewer :slide="s" :width="112" flat />
              <div class="thumb-ops">
                <button title="上移" :disabled="i === 0" @click.stop="railMove(i, -1)">↑</button>
                <button title="下移" :disabled="i === total - 1" @click.stop="railMove(i, 1)">↓</button>
                <button title="复制" @click.stop="railDup(i)">⧉</button>
                <button title="删除" :disabled="total <= 1" @click.stop="railDel(i)">✕</button>
              </div>
            </div>
          </div>
        </aside>

        <!-- 中：画布 -->
        <div
          ref="canvasEl"
          class="canvas"
          @pointerdown="onStagePointerDown"
          @dblclick="onStageDouble"
        >
          <div class="page-wrap" :style="{ width: SLIDE_W * scale + 'px', height: SLIDE_H * scale + 'px' }">
            <div class="stage" :style="stageStyle">
              <ElementView
                v-for="el in slide.elements"
                :key="el.id"
                v-show="!(el.type === 'text' && el.id === editingId)"
                :el="el"
              />
            </div>

            <!-- 悬停描边 / 选中框 + 手柄（屏幕层） -->
            <div v-if="hoverGeom && !drag" class="overlay hover-box" :style="elCss(hoverGeom)"></div>
            <div v-if="selGeom && !drag" class="overlay sel-box" :style="elCss(selGeom)">
              <i
                v-for="d in DIRS"
                :key="d"
                class="handle"
                :style="{
                  left: d.includes('e') ? '100%' : d.includes('w') ? '0%' : '50%',
                  top: d.includes('s') ? '100%' : d.includes('n') ? '0%' : '50%',
                  cursor: DIR_CURSOR[d],
                }"
                @pointerdown.prevent.stop="beginResize(d, $event)"
              ></i>
            </div>

            <!-- 就地文本编辑 -->
            <textarea
              v-if="editingEl"
              ref="editEl"
              v-model="editingText"
              class="edit-area"
              :style="editingCss"
              spellcheck="false"
              @pointerdown.stop
              @input="onEditInput"
              @keydown="onEditKey"
              @blur="commitEdit"
            ></textarea>
          </div>
        </div>

        <!-- 右：属性面板 -->
        <aside class="inspector">
          <template v-if="selText">
            <div class="ins-title">文字</div>
            <textarea
              class="prop-area"
              :value="selText.text"
              spellcheck="false"
              @input="setTextContent(($event.target as HTMLTextAreaElement).value)"
            ></textarea>

            <div class="ins-sub">水平对齐</div>
            <div class="prop-grid cols3">
              <button v-for="a in (['left', 'center', 'right'] as const)" :key="a" class="seg" :class="{ on: selText.align === a }" @click="setTextProps({ align: a })">
                {{ { left: '⇤ 左', center: '↔ 中', right: '⇥ 右' }[a] }}
              </button>
            </div>

            <div class="ins-sub">垂直对齐</div>
            <div class="prop-grid cols3">
              <button v-for="v in (['top', 'middle', 'bottom'] as const)" :key="v" class="seg" :class="{ on: (selText.valign ?? 'top') === v }" @click="setTextProps({ valign: v })">
                {{ { top: '顶', middle: '中', bottom: '底' }[v] }}
              </button>
            </div>

            <div class="row">
              <span>字号</span>
              <input type="number" :value="selText.fontSize" min="8" max="300" @change="setTextProps({ fontSize: Number(($event.target as HTMLInputElement).value) })" />
            </div>
            <div class="row">
              <span>加粗</span>
              <label class="switch"><input type="checkbox" :checked="selText.fontWeight === 700" @change="setTextProps({ fontWeight: ($event.target as HTMLInputElement).checked ? 700 : 400 })" /><i></i></label>
            </div>
            <div class="row">
              <span>斜体</span>
              <label class="switch"><input type="checkbox" :checked="!!selText.italic" @change="setTextProps({ italic: ($event.target as HTMLInputElement).checked })" /><i></i></label>
            </div>
            <div class="row">
              <span>行高</span>
              <input type="number" step="0.05" :value="selText.lineHeight ?? 1.4" min="0.8" max="3" @change="setTextProps({ lineHeight: Number(($event.target as HTMLInputElement).value) })" />
            </div>

            <div class="ins-sub">颜色</div>
            <div class="color-row">
              <button
                v-for="c in ACCENTS.concat(['#ffffff', '#1f2340', '#0f0f1a', '#10b981'])"
                :key="c"
                class="sw"
                :style="{ background: c }"
                :class="{ on: selText.color.toLowerCase() === c.toLowerCase() }"
                @click="setTextProps({ color: c })"
              ></button>
              <input type="color" :value="selText.color" class="native-color" @change="setTextProps({ color: ($event.target as HTMLInputElement).value })" />
            </div>
          </template>

          <template v-else-if="selRect">
            <div class="ins-title">形状</div>
            <div class="ins-sub">填充</div>
            <div class="color-row">
              <button
                v-for="c in ACCENTS.concat(['#ffffff', '#1f2340', '#10b981', '#f59e0b', '#0ea5e9'])"
                :key="c"
                class="sw"
                :style="{ background: c }"
                @click="setRectProps({ bg: c })"
              ></button>
              <input type="color" :value="selRect.bg" class="native-color" @change="setRectProps({ bg: ($event.target as HTMLInputElement).value })" />
            </div>
            <div class="row">
              <span>圆角</span>
              <input type="number" :value="selRect.radius" min="0" max="300" @change="setRectProps({ radius: Number(($event.target as HTMLInputElement).value) })" />
            </div>
            <div class="row">
              <span>描边色</span>
              <input type="color" :value="selRect.borderColor ?? '#000000'" class="native-color" @change="setRectProps({ borderColor: ($event.target as HTMLInputElement).value })" />
            </div>
          </template>

          <template v-else-if="selChart">
            <div class="ins-title">图表</div>
            <div class="ins-sub">类型</div>
            <div class="prop-grid cols3">
              <button
                v-for="t in (['bar', 'column', 'line', 'area', 'pie', 'ring'] as const)"
                :key="t"
                class="seg"
                :class="{ on: selChart.chart.chartType === t }"
                @click="setChartType(t)"
              >{{ { bar: '柱', column: '柱', line: '折线', area: '面积', pie: '饼', ring: '环' }[t] }}</button>
            </div>
            <p class="tip">图表数据来自当前大纲内容项；需要改数据请在生成页重新生成，或导入新的 JSON。</p>
          </template>

          <template v-else>
            <div class="ins-title">页面设置</div>
            <div class="meta-line">
              <span class="chip big">{{ SLIDE_TYPE_LABELS[slide.type] }}</span>
              <span class="muted">{{ slide.elements.length }} 个元素</span>
            </div>

            <div class="ins-sub">主色</div>
            <div class="color-row">
              <button
                v-for="c in ACCENTS"
                :key="c"
                class="sw"
                :style="{ background: c }"
                :class="{ on: slide.accent === c }"
                @click="setAccent(c)"
              ></button>
            </div>

            <div class="ins-sub">背景预设</div>
            <div class="bg-grid">
              <button
                v-for="(p, i) in BACKGROUND_PRESETS"
                :key="i"
                class="bg-thumb"
                :class="{ on: slide.background.css === p.bg.css }"
                :style="{ background: p.bg.css }"
                :title="p.label"
                @click="setBackground(i)"
              >{{ p.label }}</button>
            </div>

            <div class="ins-sub">自定义背景 CSS</div>
            <input type="text" class="prop-input" :value="slide.background.css" @change="setBgCss(($event.target as HTMLInputElement).value)" />
          </template>

          <template v-if="selected">
            <div class="divider" />
            <div class="ins-title">元素</div>
            <div class="prop-grid cols3">
              <button class="seg" @click="layer('back')">后移</button>
              <button class="seg" @click="layer('front')">前移</button>
              <button class="seg warn" @click="deleteSelected">删除</button>
            </div>
            <div class="row">
              <span>锁定（不可拖动）</span>
              <label class="switch"><input type="checkbox" :checked="!!selected.lock" @change="toggleLock" /><i></i></label>
            </div>
          </template>
        </aside>
      </div>
    </template>

    <!-- 空态 -->
    <div v-else class="empty">
      <h2>还没有幻灯片</h2>
      <p>先从「生成」页按大纲流式生成，或直接载入一份演示数据开始编辑。</p>
      <div class="empty-actions">
        <button class="btn primary" @click="goGenerate">去生成 PPT</button>
        <button class="btn ghost" @click="loadDemo">载入演示数据</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.toolbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: #fff;
  border-bottom: 1px solid #e7eaf3;
  z-index: 5;
}
.tb-group {
  display: flex;
  align-items: center;
  gap: 4px;
}
.tb-group.mid {
  margin: 0 auto;
}
.tb-group.right {
  margin-left: auto;
  flex: none;
}
.tb-btn {
  border: none;
  background: transparent;
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 13px;
  color: #4b5563;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}
.tb-btn:hover:not(:disabled) {
  background: #eef1fb;
}
.tb-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.tb-btn.accent {
  color: #667eea;
  font-weight: 600;
}
.tb-btn.play {
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: #fff;
  font-weight: 600;
}
.divider {
  width: 1px;
  height: 18px;
  background: #e7eaf3;
  margin: 0 4px;
}
.page-no {
  font-size: 13px;
  color: #667eea;
  font-weight: 700;
}
.chip {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 999px;
  background: #eef1fb;
  color: #5b6478;
}
.chip.big {
  font-size: 14px;
  padding: 4px 12px;
}
.muted {
  color: #9aa2b5;
  font-size: 13px;
}
.zoom-label {
  min-width: 44px;
  text-align: center;
  font-size: 12px;
  color: #6b7280;
}

.body {
  flex: 1;
  min-height: 0;
  display: flex;
}
.rail {
  width: 168px;
  flex: none;
  background: #f7f8fc;
  border-right: 1px solid #e7eaf3;
  display: flex;
  flex-direction: column;
}
.rail-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 10px 4px;
  font-size: 12px;
  font-weight: 700;
  color: #7a8296;
}
.icon-btn {
  border: none;
  background: transparent;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  color: #667eea;
  font-size: 18px;
  cursor: pointer;
}
.insert-menu {
  padding: 2px 8px 6px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}
.insert-item {
  border: none;
  background: #fff;
  border-radius: 8px;
  padding: 6px 4px;
  font-size: 12px;
  cursor: pointer;
  color: #4b5563;
}
.insert-item:hover {
  background: #667eea;
  color: #fff;
}
.thumbs {
  flex: 1;
  overflow-y: auto;
  padding: 4px 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.thumb {
  position: relative;
  border-radius: 8px;
  border: 2px solid transparent;
  cursor: pointer;
  overflow: hidden;
  transition: border-color 0.15s;
  flex: none;
}
.thumb:hover {
  border-color: #cdd6f5;
}
.thumb.active {
  border-color: #667eea;
}
.thumb-no {
  position: absolute;
  z-index: 2;
  left: 4px;
  top: 4px;
  font-size: 11px;
  background: rgba(15, 23, 42, 0.6);
  color: #fff;
  padding: 0 6px;
  border-radius: 6px;
}
.thumb-ops {
  position: absolute;
  right: 4px;
  top: 4px;
  display: none;
  gap: 2px;
}
.thumb:hover .thumb-ops {
  display: flex;
}
.thumb-ops button {
  border: none;
  background: rgba(15, 23, 42, 0.65);
  color: #fff;
  width: 22px;
  height: 20px;
  font-size: 11px;
  border-radius: 6px;
  cursor: pointer;
}
.thumb-ops button:disabled {
  opacity: 0.4;
}

.canvas {
  flex: 1;
  overflow: auto;
  background-color: #eceef5;
  background-image: radial-gradient(#cfd5e6 1px, transparent 1px);
  background-size: 20px 20px;
  position: relative;
}
.page-wrap {
  position: relative;
  margin: 24px auto;
  width: fit-content;
}
.stage {
  position: relative;
  transform-origin: 0 0;
  box-shadow: 0 10px 40px rgba(30, 40, 80, 0.18);
}
.overlay {
  position: absolute;
  top: 0;
  left: 0;
}
.hover-box {
  border: 1px dashed rgba(102, 126, 234, 0.85);
  pointer-events: none;
  z-index: 21;
}
.sel-box {
  border: 2px solid #667eea;
  pointer-events: none;
  z-index: 22;
}
.handle {
  position: absolute;
  width: 12px;
  height: 12px;
  background: #fff;
  border: 2px solid #667eea;
  border-radius: 3px;
  transform: translate(-50%, -50%);
  pointer-events: auto;
  box-sizing: border-box;
  z-index: 23;
}
.edit-area {
  position: absolute;
  z-index: 30;
  top: 0;
  left: 0;
  border: 2px solid #667eea;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.55);
  padding: 2px 4px;
  resize: none;
  outline: none;
  overflow: hidden;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
}

.inspector {
  width: 280px;
  flex: none;
  background: #fff;
  border-left: 1px solid #e7eaf3;
  overflow-y: auto;
  padding: 16px;
}
.ins-title {
  font-size: 14px;
  font-weight: 800;
  color: #1d2140;
  margin-bottom: 10px;
}
.ins-sub {
  font-size: 11px;
  color: #9aa2b5;
  font-weight: 700;
  margin: 14px 0 6px;
  letter-spacing: 0.5px;
}
.meta-line {
  display: flex;
  gap: 8px;
  align-items: center;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 8px 0;
  font-size: 13px;
  color: #4b5563;
}
.row input[type='number'] {
  width: 76px;
  border: 1px solid #e2e6f0;
  border-radius: 8px;
  padding: 5px 8px;
  text-align: right;
  font-size: 13px;
  outline: none;
}
.prop-input {
  width: 100%;
  border: 1px solid #e2e6f0;
  border-radius: 8px;
  padding: 6px 8px;
  font-size: 12px;
  outline: none;
  box-sizing: border-box;
}
.prop-area {
  width: 100%;
  min-height: 90px;
  border: 1px solid #e2e6f0;
  border-radius: 10px;
  padding: 8px 10px;
  font-size: 13px;
  line-height: 1.6;
  resize: vertical;
  font-family: inherit;
  outline: none;
  color: #2a3152;
  box-sizing: border-box;
}
.tip {
  font-size: 12px;
  color: #9aa2b5;
  line-height: 1.6;
  margin-top: 10px;
}
.prop-grid {
  display: grid;
  gap: 6px;
  margin: 4px 0;
}
.prop-grid.cols3 {
  grid-template-columns: repeat(3, 1fr);
}
.seg {
  border: 1px solid #e2e6f0;
  background: #fff;
  border-radius: 8px;
  padding: 6px 4px;
  font-size: 12px;
  color: #4b5563;
  cursor: pointer;
  text-align: center;
}
.seg.on {
  background: #eef1fb;
  border-color: #667eea;
  color: #4f46e5;
  font-weight: 600;
}
.seg.warn {
  color: #dc2626;
}
.color-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.sw {
  width: 24px;
  height: 24px;
  border-radius: 7px;
  border: 2px solid #fff;
  box-shadow: 0 0 0 1px #e0e4ef;
  cursor: pointer;
  box-sizing: border-box;
}
.sw.on {
  box-shadow: 0 0 0 2px #667eea;
}
.native-color {
  width: 28px;
  height: 26px;
  border: none;
  padding: 0;
  background: transparent;
  cursor: pointer;
}
.bg-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}
.bg-thumb {
  height: 44px;
  border-radius: 8px;
  border: 2px solid transparent;
  color: rgba(255, 255, 255, 0.92);
  font-size: 11px;
  font-weight: 700;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
  cursor: pointer;
  background-position: center;
}
.bg-thumb.on {
  border-color: #667eea;
}
.switch {
  position: relative;
  display: inline-flex;
}
.switch input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}
.switch i {
  width: 36px;
  height: 20px;
  border-radius: 999px;
  background: #d5dbe8;
  position: relative;
  transition: 0.2s;
  cursor: pointer;
  display: inline-block;
}
.switch i::after {
  content: '';
  position: absolute;
  left: 2px;
  top: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  transition: 0.2s;
}
.switch input:checked + i {
  background: #667eea;
}
.switch input:checked + i::after {
  left: 18px;
}

.empty {
  flex: 1;
  display: grid;
  place-content: center;
  text-align: center;
  gap: 10px;
  background: #fff;
  align-items: center;
  padding: 32px;
}
.empty h2 {
  color: #1d2140;
}
.empty p {
  color: #9aa2b5;
}
.empty-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
}
.btn {
  border: none;
  border-radius: 10px;
  padding: 10px 18px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}
.btn.primary {
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: #fff;
}
.btn.ghost {
  background: #eef1fb;
  color: #4f46e5;
}
</style>
