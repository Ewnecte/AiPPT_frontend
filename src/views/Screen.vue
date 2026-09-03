<script setup lang="ts">
// P07 演示放映页
// 全屏播放、缩放自适应、键盘/点击翻页、放映控制条、正计时/每页倒计时、
// 画笔、演讲者视图（缩略图 + 备注）。后端未就绪时用示例数据演示，
// 接入真实内容后 store.slides 会自动优先。
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useSlidesStore } from '../store/slides'
import { sampleSlides } from '../utils/sampleSlides'
import type { SlideSchema } from '../types/AIPPT'
import SlideRenderer from '../components/SlideRenderer.vue'

const router = useRouter()
const store = useSlidesStore()

/* ---------------- 数据源 ---------------- */
const list = computed<SlideSchema[]>(() => (store.slides.length ? store.slides : sampleSlides))
const total = computed(() => list.value.length)
const currentIndex = ref(0)
const current = computed(() => list.value[currentIndex.value] ?? list.value[0])

function goPrev() {
  currentIndex.value = Math.max(0, currentIndex.value - 1)
  resetCountdown()
}
function goNext() {
  currentIndex.value = Math.min(total.value - 1, currentIndex.value + 1)
  resetCountdown()
}
function jumpTo(i: number) {
  if (i >= 0 && i < total.value) {
    currentIndex.value = i
    resetCountdown()
  }
}

/* ---------------- 缩放自适应（基准 1280 x 720） ---------------- */
const SCALE_W = 1280
const SCALE_H = 720
const scale = ref(1)
function computeScale() {
  scale.value = Math.min(window.innerWidth / SCALE_W, window.innerHeight / SCALE_H)
}

/* ---------------- 计时：正计时 + 每页倒计时 ---------------- */
const elapsed = ref(0)
const countdownMin = ref(0) // 0 = 关闭
const leftSec = ref(0)
const countdownFlash = ref(false)
let timerId: ReturnType<typeof setInterval> | undefined

const countdownOptions = [
  { value: 0, label: '倒计时：关' },
  { value: 1, label: '每页 1 分钟' },
  { value: 3, label: '每页 3 分钟' },
  { value: 5, label: '每页 5 分钟' },
  { value: 10, label: '每页 10 分钟' },
]

function resetCountdown() {
  if (countdownMin.value > 0) leftSec.value = countdownMin.value * 60
  countdownFlash.value = false
}
function tick() {
  elapsed.value += 1
  if (countdownMin.value > 0 && leftSec.value > 0) {
    leftSec.value -= 1
    countdownFlash.value = leftSec.value <= 0
  }
}
function fmt(s: number): string {
  const m = Math.floor(Math.max(0, s) / 60)
  const ss = Math.max(0, s) % 60
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

/* ---------------- 画笔 ---------------- */
const penMode = ref(false)
const penColor = ref('#ff5252')
const penColors = ['#ff5252', '#ffd166', '#ffffff', '#4fc3f7']
const penDown = ref(false)
const penCanvas = ref<HTMLCanvasElement | null>(null)
let penCtx: CanvasRenderingContext2D | null = null

function setupPenCanvas() {
  const cvs = penCanvas.value
  if (!cvs) return
  cvs.width = window.innerWidth
  cvs.height = window.innerHeight
  penCtx = cvs.getContext('2d')
}
function onPenDown(e: PointerEvent) {
  penDown.value = true
  penCtx?.beginPath()
  penCtx?.moveTo(e.clientX, e.clientY)
  penCanvas.value?.setPointerCapture(e.pointerId)
}
function onPenMove(e: PointerEvent) {
  if (!penDown.value) return
  const ctx = penCtx
  if (!ctx) return
  ctx.strokeStyle = penColor.value
  ctx.lineWidth = 4
  ctx.lineCap = 'round'
  ctx.lineTo(e.clientX, e.clientY)
  ctx.stroke()
}
function onPenUp() {
  penDown.value = false
}
function clearPen() {
  if (penCtx) penCtx.clearRect(0, 0, window.innerWidth, window.innerHeight)
}
function togglePen() {
  penMode.value = !penMode.value
  if (penMode.value) setupPenCanvas()
  clearPen()
  showBars.value = true
  armHideBars()
}

/* ---------------- 演讲者视图 ---------------- */
const showSpeaker = ref(false)
const notes = reactive<Record<number, string>>({})

/* ---------------- 控制条显隐（自动隐藏） ---------------- */
const showBars = ref(true)
let hideTimer: ReturnType<typeof setTimeout> | undefined
function armHideBars() {
  showBars.value = true
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = setTimeout(() => {
    showBars.value = false
  }, 3500)
}
function poke() {
  armHideBars()
}

/* ---------------- 全屏 ---------------- */
const isFullscreen = ref(false)
async function toggleFullscreen() {
  if (document.fullscreenElement) {
    await document.exitFullscreen()
  } else {
    await document.documentElement.requestFullscreen().catch(() => undefined)
  }
}
function onFsChange() {
  isFullscreen.value = Boolean(document.fullscreenElement)
}

/* ---------------- 键盘 ---------------- */
function onKey(e: KeyboardEvent) {
  // 在输入框 / 下拉框内输入时不触发翻页
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
  if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown' || e.key === 'Enter') {
    e.preventDefault()
    goNext()
  } else if (e.key === 'ArrowLeft' || e.key === 'PageUp' || e.key === 'Backspace') {
    e.preventDefault()
    goPrev()
  } else if (e.key === 'Home') {
    jumpTo(0)
  } else if (e.key === 'End') {
    jumpTo(total.value - 1)
  } else if (e.key === 'Escape') {
    if (document.fullscreenElement) document.exitFullscreen()
    else exitScreen()
  } else if (e.key.toLowerCase() === 'f') {
    toggleFullscreen()
  }
}

function exitScreen() {
  if (document.fullscreenElement) document.exitFullscreen()
  router.push('/editor')
}

/* ---------------- 生命周期 ---------------- */
onMounted(() => {
  computeScale()
  resetCountdown()
  timerId = setInterval(tick, 1000)
  window.addEventListener('resize', computeScale)
  window.addEventListener('keydown', onKey)
  document.addEventListener('fullscreenchange', onFsChange)
  armHideBars()
})
onBeforeUnmount(() => {
  if (timerId) clearInterval(timerId)
  if (hideTimer) clearTimeout(hideTimer)
  window.removeEventListener('resize', computeScale)
  window.removeEventListener('keydown', onKey)
  document.removeEventListener('fullscreenchange', onFsChange)
})

/* ---------------- 放映点击区（前进一页） ---------------- */
function onStageClick() {
  if (penMode.value) return
  if (!showSpeaker.value) goNext()
}
</script>

<template>
  <div class="scrn" @mousemove="poke" @touchstart.passive="poke">
    <!-- 幻灯片舞台 -->
    <div class="stage" @click="onStageClick">
      <div
        class="slide-fixed"
        :style="{ transform: `scale(${scale})`, width: SCALE_W + 'px', height: SCALE_H + 'px' }"
      >
        <SlideRenderer :slide="current" :index="currentIndex" :total="total" />
      </div>
    </div>

    <!-- 画笔层 -->
    <canvas
      v-show="penMode"
      ref="penCanvas"
      class="pen-layer"
      :class="{ active: penDown }"
      @pointerdown="onPenDown"
      @pointermove="onPenMove"
      @pointerup="onPenUp"
      @pointercancel="onPenUp"
      @pointerleave="onPenUp"
    />

    <!-- 顶部信息栏 -->
    <transition name="fade">
      <div v-show="showBars && !showSpeaker" class="top-bar">
        <div class="tb-left">
          <button class="icon-btn" title="退出放映 (Esc)" @click="exitScreen">✕</button>
          <span class="clock" title="本场已进行时间">⏱ {{ fmt(elapsed) }}</span>
          <span v-if="countdownMin > 0" class="clock count" :class="{ flash: countdownFlash }" title="每页倒计时">
            本页剩余 {{ fmt(leftSec) }}
          </span>
        </div>
        <div class="tb-right">
          <select v-model.number="countdownMin" class="mini-select" title="每页倒计时设置" @change="resetCountdown">
            <option v-for="o in countdownOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
          <button class="icon-btn" :class="{ on: isFullscreen }" title="全屏 (F)" @click="toggleFullscreen">⛶</button>
        </div>
      </div>
    </transition>

    <!-- 底部控制条 -->
    <transition name="fade">
      <div v-show="showBars && !showSpeaker" class="ctrl-bar" @click.stop>
        <button class="btn-c" title="上一页 (←)" @click="goPrev">‹</button>
        <div class="page-ind">
          <span class="cur">{{ currentIndex + 1 }}</span> / {{ total }}
        </div>
        <button class="btn-c" title="下一页 (→)" @click="goNext">›</button>

        <div class="spacer" />

        <button class="btn-c" :class="{ on: penMode }" title="画笔 (点击后按住拖动画线)" @click="togglePen">✏️</button>
        <template v-if="penMode">
          <button
            v-for="c in penColors"
            :key="c"
            class="color-dot"
            :style="{ background: c }"
            :class="{ on: penColor === c }"
            @click="penColor = c"
          />
          <button class="btn-c" title="清空画笔" @click="clearPen">🧽</button>
        </template>

        <button class="btn-c" :class="{ on: showSpeaker }" title="演讲者视图" @click="showSpeaker = !showSpeaker">👁</button>
      </div>
    </transition>

    <!-- 演讲者视图面板 -->
    <transition name="panel">
      <aside v-if="showSpeaker" class="speaker">
        <header class="sp-head">
          <strong>演讲者视图</strong>
          <button class="icon-btn" title="收起" @click="showSpeaker = false">✕</button>
        </header>
        <div class="sp-thumbs">
          <button
            v-for="(s, i) in list"
            :key="i"
            class="thumb"
            :class="{ active: i === currentIndex }"
            @click="jumpTo(i)"
          >
            <span class="thumb-frame"><span class="thumb-zoom"><SlideRenderer :slide="s" :index="i" :total="total" /></span></span>
            <em>{{ i + 1 }}</em>
          </button>
        </div>
        <label class="sp-note">
          <span>本页备注</span>
          <textarea v-model="notes[currentIndex]" rows="3" placeholder="在此记录演讲要点…"></textarea>
        </label>
      </aside>
    </transition>

    <!-- 底部进度条 -->
    <div class="progress">
      <div class="progress-inner" :style="{ width: ((currentIndex + 1) / total) * 100 + '%' }"></div>
    </div>

    <!-- 键盘/使用提示 -->
    <div v-if="showBars && !showSpeaker && !penMode" class="hint">← → 翻页 · F 全屏 · ✕ 退出</div>
  </div>
</template>

<style scoped>
.scrn {
  position: fixed;
  inset: 0;
  background: radial-gradient(1200px 800px at 50% 30%, #161a2e 0%, #0b0d16 70%);
  overflow: hidden;
  user-select: none;
  cursor: default;
}
.stage {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
}
.slide-fixed {
  position: relative;
  flex-shrink: 0;
  border-radius: 2px;
  box-shadow: 0 30px 90px rgba(0, 0, 0, 0.55);
  transform-origin: center center;
}
/* 让 SlideRenderer 实际占据 100% 容器 */
.slide-fixed :deep(.sr) {
  width: 100%;
  height: 100%;
}
.slide-fixed :deep(*) {
  box-sizing: border-box;
}

/* 画笔层 */
.pen-layer {
  position: absolute;
  inset: 0;
  touch-action: none;
  cursor: crosshair;
  z-index: 20;
}
.pen-layer.active {
  cursor: crosshair;
}

/* 顶栏 / 底栏 */
.top-bar,
.ctrl-bar {
  position: absolute;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 18px;
  color: #e8eaf6;
  z-index: 30;
}
.top-bar {
  top: 0;
  height: 56px;
  justify-content: space-between;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.55), transparent);
}
.ctrl-bar {
  bottom: 0;
  height: 64px;
  justify-content: flex-start;
  background: linear-gradient(0deg, rgba(0, 0, 0, 0.6), transparent);
}
.tb-left,
.tb-right {
  display: flex;
  align-items: center;
  gap: 12px;
}
.clock {
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  background: rgba(255, 255, 255, 0.12);
  padding: 6px 12px;
  border-radius: 8px;
}
.clock.count.flash {
  color: #ff5252;
  animation: blink 0.5s step-start infinite;
}
@keyframes blink {
  50% {
    opacity: 0.25;
  }
}
.mini-select {
  background: rgba(255, 255, 255, 0.14);
  color: #e8eaf6;
  border: none;
  border-radius: 8px;
  padding: 6px 8px;
  font-size: 13px;
  outline: none;
}
.mini-select option {
  color: #1f2430;
}

/* 按钮 */
.icon-btn {
  border: none;
  background: transparent;
  color: #fff;
  font-size: 18px;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  cursor: pointer;
  display: grid;
  place-items: center;
}
.icon-btn:hover {
  background: rgba(255, 255, 255, 0.14);
}
.icon-btn.on {
  background: rgba(255, 255, 255, 0.25);
}
.btn-c {
  min-width: 46px;
  height: 46px;
  padding: 0 14px;
  border: none;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  font-size: 22px;
  cursor: pointer;
  display: grid;
  place-items: center;
}
.btn-c:hover {
  background: rgba(255, 255, 255, 0.22);
}
.btn-c.on {
  background: #6366f1;
}
.page-ind {
  font-size: 15px;
  min-width: 60px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.page-ind .cur {
  font-size: 20px;
  font-weight: 700;
  color: #fff;
}
.spacer {
  flex: 1;
}
.color-dot {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
}
.color-dot.on {
  border-color: #fff;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.4);
}

/* 演讲者视图 */
.speaker {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 340px;
  z-index: 40;
  background: #141828;
  color: #e8eaf6;
  display: flex;
  flex-direction: column;
  padding: 14px;
  box-shadow: -20px 0 60px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}
.sp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}
.sp-thumbs {
  flex: 1;
  overflow-y: auto;
  margin: 12px 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  scrollbar-width: thin;
}
.thumb {
  display: flex;
  align-items: center;
  gap: 10px;
  border: none;
  background: rgba(255, 255, 255, 0.06);
  padding: 6px;
  border-radius: 10px;
  cursor: pointer;
  color: #fff;
}
.thumb.active {
  background: #6366f1;
}
.thumb-frame {
  position: relative;
  width: 128px;
  height: 72px;
  display: block;
  overflow: hidden;
  border-radius: 6px;
  background: #fff;
  flex-shrink: 0;
}
/* 以 1280x720 设计稿渲染后用 transform 缩放到缩略图尺寸 */
.thumb-zoom {
  position: absolute;
  top: 0;
  left: 0;
  width: 1280px;
  height: 720px;
  transform-origin: top left;
  transform: scale(0.1);
  pointer-events: none;
}
.thumb em {
  font-style: normal;
  font-size: 12px;
  opacity: 0.7;
}
.sp-note {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: #aeb6d6;
}
.sp-note textarea {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  color: #fff;
  padding: 8px;
  font-family: inherit;
  font-size: 13px;
  resize: none;
  outline: none;
}

/* 进度条 */
.progress {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 3px;
  z-index: 35;
  background: rgba(255, 255, 255, 0.08);
}
.progress-inner {
  height: 100%;
  background: linear-gradient(90deg, #6366f1, #a855f7);
  transition: width 0.25s;
}

.hint {
  position: absolute;
  bottom: 78px;
  left: 50%;
  transform: translateX(-50%);
  color: rgba(255, 255, 255, 0.55);
  font-size: 12px;
  letter-spacing: 0.5px;
  z-index: 25;
  pointer-events: none;
}

/* 过渡动画 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
.panel-enter-active,
.panel-leave-active {
  transition: transform 0.3s ease;
}
.panel-enter-from,
.panel-leave-to {
  transform: translateX(100%);
}
</style>
