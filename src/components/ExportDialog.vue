<script setup lang="ts">
// 导出对话框（P06）：PPTX / PDF / 图片 / JSON
// 负责收集导出参数并驱动导出流程。当前导出为前端侧流程演示，
// 后端导出接口就绪后，将 doExport() 内的模拟进度替换为真实调用即可。
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useSlidesStore } from '../store/slides'
import { sampleSlides } from '../utils/sampleSlides'

const emit = defineEmits<{ close: [] }>()

const store = useSlidesStore()

type Format = 'pptx' | 'pdf' | 'image' | 'json'
interface FormatMeta {
  key: Format
  label: string
  desc: string
  ext: string
}
const formats: FormatMeta[] = [
  { key: 'pptx', label: 'PPTX', desc: 'PowerPoint 演示文稿', ext: '.pptx' },
  { key: 'pdf', label: 'PDF', desc: '便携式文档 / 打印', ext: '.pdf' },
  { key: 'image', label: '图片', desc: '逐页导出 PNG / JPEG', ext: '.zip' },
  { key: 'json', label: 'JSON', desc: '完整工程数据，可再次导入编辑', ext: '.json' },
]

const format = ref<Format>('pptx')
const fileName = ref('AiPPT-演示文稿')
const range = ref<'all' | 'current'>('all')
const size = ref('16:9')
const imgExt = ref<'png' | 'jpeg'>('png')
const imgQuality = ref<'high' | 'normal' | 'low'>('high')
const withTemplate = ref(true)
const includeNotes = ref(false)

// 页数：优先取真实 slides；尚未生成内容时以内置页兜底，保证导出流程可走通
const totalPages = computed(() => store.slides.length || sampleSlides.length)
const targetPages = computed(() => {
  const n = totalPages.value
  return range.value === 'all' ? n : 1
})
const targetDesc = computed(() =>
  range.value === 'all' ? `全部 ${n()} 页` : `当前第 ${store.currentIndex + 1} 页`,
)

function n() {
  return totalPages.value
}

const exporting = ref(false)
const progress = ref(0)
const stageText = ref('')
const done = ref(false)

let timer: ReturnType<typeof setInterval> | undefined
function doExport() {
  if (exporting.value) return
  exporting.value = true
  done.value = false
  progress.value = 0
  stageText.value = '正在排版内容…'

  timer = setInterval(() => {
    const step = Math.round(Math.random() * 14 + 4)
    progress.value = Math.min(100, progress.value + step)
    if (progress.value >= 40 && progress.value < 80) {
      stageText.value = `正在导出第 ${Math.min(targetPages.value, Math.ceil((progress.value / 100) * totalPages.value))} / ${totalPages.value} 页…`
    } else if (progress.value >= 80 && progress.value < 100) {
      stageText.value = '正在压缩与打包资源…'
    }
    if (progress.value >= 100) {
      if (timer) clearInterval(timer)
      timer = undefined
      exporting.value = false
      done.value = true
      stageText.value = ''
    }
  }, 150)
}

// 说明：接后端导出接口后，在拿到导出结果时于此触发真实文件下载即可
const outName = computed(() => fileName.value + (formats.find((f) => f.key === format.value)?.ext ?? ''))

function handleKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && !exporting.value) {
    emit('close')
  }
}
onMounted(() => window.addEventListener('keydown', handleKey))
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
  window.removeEventListener('keydown', handleKey)
})
</script>

<template>
  <div class="mask" @click.self="done && $emit('close')">
    <div class="dialog" role="dialog" aria-modal="true">
      <header class="dlg-head">
        <h3>导出演示文稿</h3>
        <button class="x" title="关闭" :disabled="exporting" @click="$emit('close')">✕</button>
      </header>

      <!-- 结果态 -->
      <div v-if="done" class="done">
        <div class="done-icon">🎉</div>
        <p class="done-name">{{ outName }}</p>
        <p class="done-tip">导出任务已完成，文件已生成。</p>
        <button class="btn primary" @click="$emit('close')">完成</button>
      </div>

      <!-- 编辑态 -->
      <template v-else>
        <div class="fmt-grid">
          <button
            v-for="f in formats"
            :key="f.key"
            class="fmt"
            :class="{ on: format === f.key }"
            @click="format = f.key"
          >
            <strong>{{ f.label }}</strong>
            <small>{{ f.desc }}</small>
          </button>
        </div>

        <section class="opts">
          <label class="row">
            <span class="lab">文件名</span>
            <input v-model="fileName" class="in" placeholder="演示文稿名称" />
            <code class="ext">{{ formats.find((f) => f.key === format)?.ext }}</code>
          </label>

          <div class="row">
            <span class="lab">导出范围</span>
            <div class="seg">
              <button class="seg-btn" :class="{ on: range === 'all' }" @click="range = 'all'">全部 {{ n() }} 页</button>
              <button class="seg-btn" :class="{ on: range === 'current' }" @click="range = 'current'">仅当前页</button>
            </div>
          </div>

          <div class="row" v-if="format === 'pptx' || format === 'pdf'">
            <span class="lab">画布尺寸</span>
            <div class="seg">
              <button class="seg-btn" :class="{ on: size === '16:9' }" @click="size = '16:9'">16:9（宽屏）</button>
              <button class="seg-btn" :class="{ on: size === '4:3' }" @click="size = '4:3'">4:3（标屏）</button>
            </div>
          </div>

          <div class="row" v-if="format === 'pdf'">
            <label class="chk">
              <input type="checkbox" v-model="includeNotes" />
              <span>附加演讲者备注页</span>
            </label>
          </div>

          <div class="row" v-if="format === 'image'">
            <span class="lab">图片格式</span>
            <div class="seg">
              <button class="seg-btn" :class="{ on: imgExt === 'png' }" @click="imgExt = 'png'">PNG</button>
              <button class="seg-btn" :class="{ on: imgExt === 'jpeg' }" @click="imgExt = 'jpeg'">JPEG</button>
            </div>
            <span class="lab sub-lab">质量</span>
            <div class="seg">
              <button class="seg-btn" :class="{ on: imgQuality === 'high' }" @click="imgQuality = 'high'">高</button>
              <button class="seg-btn" :class="{ on: imgQuality === 'normal' }" @click="imgQuality = 'normal'">中</button>
              <button class="seg-btn" :class="{ on: imgQuality === 'low' }" @click="imgQuality = 'low'">低</button>
            </div>
          </div>

          <div class="row" v-if="format === 'json'">
            <label class="chk">
              <input type="checkbox" v-model="withTemplate" />
              <span>包含模板信息（可在编辑器重新套用）</span>
            </label>
          </div>
        </section>

        <p class="scope-tip">将导出：{{ outName }}（{{ targetDesc }}）</p>

        <!-- 进度 -->
        <div v-if="exporting" class="prog-wrap">
          <div class="prog"><i :style="{ width: progress + '%' }"></i></div>
          <p class="prog-text">{{ stageText }} {{ progress }}%</p>
        </div>

        <footer class="dlg-foot">
          <button class="btn ghost" :disabled="exporting" @click="$emit('close')">取消</button>
          <button class="btn primary" :disabled="exporting" @click="doExport">
            {{ exporting ? '导出中…' : '导出' }}
          </button>
        </footer>
      </template>
    </div>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 18, 32, 0.55);
  backdrop-filter: blur(3px);
  display: grid;
  place-items: center;
  z-index: 100;
}
.dialog {
  width: 620px;
  max-width: calc(100vw - 40px);
  max-height: calc(100vh - 60px);
  overflow: auto;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 30px 90px rgba(10, 15, 40, 0.35);
  padding: 20px 22px 22px;
}
.dlg-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.dlg-head h3 {
  font-size: 18px;
  color: #1f2430;
}
.x {
  border: none;
  background: #eef0f7;
  color: #4b5563;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  cursor: pointer;
  font-size: 14px;
}
.x:disabled {
  opacity: 0.5;
}
/* 格式卡片 */
.fmt-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
.fmt {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  border: 1.5px solid #e6e8ef;
  border-radius: 12px;
  background: #fff;
  padding: 12px;
  cursor: pointer;
  text-align: left;
  transition: 0.15s;
}
.fmt strong {
  font-size: 16px;
  color: #1f2430;
}
.fmt small {
  font-size: 11px;
  color: #8a94a6;
  line-height: 1.35;
}
.fmt:hover {
  border-color: #c7c9f4;
}
.fmt.on {
  border-color: #6366f1;
  background: #f5f6ff;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.12);
}
.fmt.on strong {
  color: #4338ca;
}

/* 选项 */
.opts {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 18px 0 6px;
  padding: 14px 0;
  border-top: 1px solid #f1f3f9;
  border-bottom: 1px solid #f1f3f9;
}
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.lab {
  width: 78px;
  font-size: 13px;
  color: #55607a;
  flex-shrink: 0;
}
.sub-lab {
  width: auto;
  margin-left: 6px;
}
.in {
  flex: 1;
  min-width: 140px;
  border: 1px solid #e0e4ef;
  border-radius: 9px;
  padding: 8px 11px;
  font-size: 14px;
  outline: none;
}
.in:focus {
  border-color: #6366f1;
}
.ext {
  font-size: 13px;
  color: #6366f1;
  background: #f0f2fb;
  padding: 3px 8px;
  border-radius: 6px;
}
.seg {
  display: inline-flex;
  border: 1px solid #e0e4ef;
  border-radius: 9px;
  overflow: hidden;
}
.seg-btn {
  border: none;
  background: #fff;
  padding: 8px 14px;
  font-size: 13px;
  color: #55607a;
  cursor: pointer;
}
.seg-btn.on {
  background: #6366f1;
  color: #fff;
  font-weight: 600;
}
.chk {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  color: #3f4a66;
  cursor: pointer;
}
.scope-tip {
  font-size: 12px;
  color: #8a94a6;
  margin: 10px 0 2px;
}

/* 进度 */
.prog-wrap {
  margin-top: 12px;
}
.prog {
  height: 8px;
  border-radius: 999px;
  background: #eef0f7;
  overflow: hidden;
}
.prog i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #667eea, #a855f7);
  border-radius: 999px;
  transition: width 0.15s;
}
.prog-text {
  font-size: 12px;
  color: #7c869c;
  margin-top: 6px;
}

.dlg-foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 18px;
}
.btn {
  border: none;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  padding: 9px 22px;
  border-radius: 10px;
}
.btn.primary {
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: #fff;
}
.btn.ghost {
  background: #eef0f7;
  color: #3f4a66;
}
.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* 结果态 */
.done {
  text-align: center;
  padding: 26px 0 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.done-icon {
  font-size: 52px;
}
.done-name {
  font-weight: 700;
  font-size: 16px;
  color: #1f2430;
  background: #f5f6ff;
  border: 1px dashed #c7c9f4;
  padding: 6px 14px;
  border-radius: 8px;
}
.done-tip {
  font-size: 12px;
  color: #8a94a6;
  max-width: 380px;
}
.done .btn {
  margin-top: 8px;
}
</style>
