<script setup lang="ts">
// P04 PPT 生成页（路由 /generate，四步流程的第四步）
// ------------------------------------------------------------------
// 从 draft store 读取大纲(可改)与模板、来源配置，调用 main_api 逐页生成；
// 模板选择页（/ppt）点「生成演示文稿」后跳转本页并自动开始生成；
// 后端不可达时自动降级为内置演示数据（离线 Demo）。
// 生成过程中实时显示：当前状态、进度条、逐页缩略图与事件日志；
// 完成后可进入编辑器 / 重新生成。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useDraftStore } from '../store/slides'
import { useGenerationStore } from '../store/generation'
import { AIPPT_StreamEvents, AIPPTByID } from '../services'
import type { SlideSchema } from '../types/AIPPT'
import SlideViewer from '../components/SlideViewer.vue'
import StepBar from '../components/StepBar.vue'
import {
  SAMPLE_OUTLINE,
  SLIDE_TYPE_LABELS,
  estimateSlideCount,
  parseOutline,
  schemasFromOutline,
} from '../utils/aippt'

const store = useDraftStore()
const gen = useGenerationStore()
const router = useRouter()

// 大纲初值：优先模板页写入的 draft meta，其次取 generation store 中的权威大纲
const outline = ref(store.meta.outline || gen.markdown || '')
const useWebSearch = ref(store.meta.source === 'web')
const language = ref(store.meta.language || gen.language || '中文')
const phase = ref<'idle' | 'connecting' | 'generating' | 'done' | 'error'>('idle')
const mode = ref<'real' | 'demo'>('real')
const statusText = ref('')
const logs = ref<string[]>([])
const notice = ref('')
const aborted = ref(false)
const openedOutline = ref(false)

let controller: AbortController | null = null
const pageTitle = computed(() => parseOutline(outline.value || SAMPLE_OUTLINE).title)
// 顶部标题：上传资料来源优先展示文档名，其次用模板页带过来的标题
const deckTitle = computed(() => {
  if (store.meta.source === 'file' && gen.fileName) return gen.fileName
  return store.meta.title || pageTitle.value
})
const estimated = computed(() => (outline.value.trim() ? estimateSlideCount(outline.value) : 0))
const progress = computed(() => {
  const total = estimated.value || store.slideCount
  if (!total) return 0
  return Math.min(100, Math.round((store.slideCount / total) * 100))
})
const running = computed(() => phase.value === 'generating' || phase.value === 'connecting')
// 是否处于「上传资料」知识库来源（由模板选择页配置），生成不依赖大纲文本
const kbMode = computed(() => store.meta.source === 'file' && Boolean(gen.fileId))

watch(outline, (v) => {
  if (v !== store.meta.outline) store.setMeta({ outline: v, title: parseOutline(v).title })
})

function pushLog(text: string) {
  logs.value.push(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${text}`)
  if (logs.value.length > 80) logs.value.shift()
}

function setStatus(text: string) {
  statusText.value = text
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function begin() {
  if (running.value) return
  const md = outline.value.trim()
  // 「上传资料」来源按知识库 fileId 生成，不强制要求本页有大纲文本
  if (!kbMode.value && !md) {
    notice.value = '请先在上方输入或粘贴 Markdown 大纲，或填入示例大纲。'
    openedOutline.value = true
    return
  }
  aborted.value = false
  notice.value = ''
  logs.value = []
  const metaPatch = {
    outline: md,
    title: store.meta.title || pageTitle.value,
    templateId: store.meta.templateId,
    language: language.value,
    source: store.meta.source,
  }
  store.seedSlides([], metaPatch)
  store.setGenerating(true)
  phase.value = 'connecting'
  setStatus('正在连接内容生成服务…')

  try {
    await runReal(md)
    if (aborted.value) return
    finishOk()
  } catch (e) {
    if (aborted.value) return
    // 后端不可达 -> 降级演示数据
    mode.value = 'demo'
    pushLog('无法连接后端(main_api :6800)，已切换到内置演示数据。')
    store.seedSlides([], metaPatch)
    await runDemo(md)
    if (aborted.value) return
    finishOk()
  }
}

/** 逐页回调：写入草稿并更新状态（生成中追加一页） */
function onSlide(slide: SlideSchema) {
  store.pushSchema(slide)
  const label = SLIDE_TYPE_LABELS[slide.type] ?? slide.type
  setStatus(`已生成第 ${store.slideCount} 页 · ${label}`)
}

async function runReal(md: string) {
  mode.value = 'real'

  if (kbMode.value) {
    // 上传资料：后端从知识库按 fileId 取回文档做检索增强生成（不依赖本页大纲）
    pushLog('正在读取知识库文档并逐页生成…')
    controller = null
    await AIPPTByID(
      gen.fileId,
      { userId: gen.userId, model: gen.model },
      (slide) => {
        if (aborted.value) return
        onSlide(slide)
      },
    )
    pushLog('知识库文档内容生成完成。')
    return
  }

  controller = new AbortController()
  await AIPPT_StreamEvents(
    md,
    {
      language: language.value,
      model: gen.model, // 显式传生成模型（与大纲配置一致），不依赖后端进程环境兜底
      generateFromWebSearch: useWebSearch.value,
      generateFromUploadedFile: store.meta.source === 'file',
      signal: controller.signal,
    },
    {
      onStatus: (text) => {
        setStatus(text)
        pushLog(text)
      },
      onSlide: (slide) => {
        if (aborted.value) return
        onSlide(slide)
      },
      onDone: () => pushLog('收到 [DONE]：内容生成完成'),
    },
  )
}

async function runDemo(md: string) {
  phase.value = 'generating'
  const schemas = schemasFromOutline(md)
  const total = schemas.length
  for (let i = 0; i < schemas.length; i++) {
    if (aborted.value) return
    const s = schemas[i]
    const label = SLIDE_TYPE_LABELS[s.type] ?? s.type
    setStatus(`正在撰写${label}页（${i + 1}/${total}）…`)
    pushLog(`正在撰写：${label}页`)
    await delay(s.type === 'cover' || s.type === 'end' ? 800 : s.type === 'contents' ? 1000 : 620)
    if (aborted.value) return
    store.pushSchema(s)
  }
  pushLog('演示数据生成完毕。')
}

function finishOk() {
  phase.value = 'done'
  store.setGenerating(false)
  const count = store.slideCount
  setStatus(`生成完成：共 ${count} 页幻灯片`)
  pushLog(`生成完成：共 ${count} 页`)
}

function stop() {
  if (!running.value) return
  aborted.value = true
  try {
    controller?.abort()
  } catch {
    /* noop */
  }
  controller = null
  store.setGenerating(false)
  phase.value = 'idle'
  setStatus('已停止。可修改大纲后重新生成。')
  pushLog('用户取消生成。')
}

function fillSample() {
  outline.value = SAMPLE_OUTLINE
  notice.value = ''
}

function goEditor() {
  router.push('/editor')
}

function backTemplates() {
  router.push('/ppt')
}

// 由 /ppt（选择模板）跳转而来：大纲/上传资料已就绪且未生成过 → 自动开始 PPT 生成
onMounted(() => {
  if (phase.value !== 'idle' || store.generating || store.slides.length > 0) return
  const hasTask = Boolean(outline.value.trim()) || kbMode.value
  if (!hasTask) return
  void begin()
})

onBeforeUnmount(() => {
  aborted.value = true
  try {
    controller?.abort()
  } catch {
    /* noop */
  }
  store.setGenerating(false)
})
</script>

<template>
  <div class="generate">
    <!-- 统一四步步骤条：P04 PPT生成 当前（完成后整条点亮） -->
    <StepBar :current="4" :done="phase === 'done' ? 4 : 3" />

    <div class="body">
      <!-- 左列：大纲 / 控制 -->
      <section class="panel control">
        <div class="panel-head">
          <span class="title">生成配置</span>
          <span v-if="mode === 'demo' && phase !== 'idle'" class="tag demo">演示模式</span>
          <span v-else-if="phase !== 'idle'" class="tag">{{ mode === 'real' ? '真实接口' : '待机' }}</span>
        </div>

        <div class="deck-title">📄 {{ deckTitle }}</div>

        <div class="row">
          <label class="lbl">数据来源</label>
          <label class="radio"><input v-model="useWebSearch" type="checkbox" :disabled="kbMode" /> 联网检索扩充内容</label>
          <span v-if="store.meta.templateId" class="badge">模板 {{ store.meta.templateId }}</span>
          <span class="badge">{{ language }}</span>
          <span v-if="kbMode" class="badge kb">知识库 · {{ gen.fileName }}</span>
        </div>

        <button class="text-btn" type="button" @click="openedOutline = !openedOutline">
          {{ openedOutline ? '收起大纲 ▼' : '查看 / 编辑大纲 ▲' }}
        </button>
        <textarea v-if="openedOutline" v-model="outline" rows="9" spellcheck="false" class="outline"></textarea>

        <div class="actions">
          <template v-if="!running">
            <button class="btn primary" type="button" :disabled="phase === 'connecting'" @click="begin">
              {{ phase === 'done' ? '↻ 重新生成' : '🚀 开始生成 PPT' }}
            </button>
            <button v-if="!outline.trim()" class="btn ghost" type="button" @click="fillSample">填入示例大纲</button>
            <button v-if="phase === 'done'" class="btn accent" type="button" @click="goEditor">进入编辑器 →</button>
          </template>
          <template v-else>
            <button class="btn danger" type="button" @click="stop">■ 停止生成</button>
          </template>
          <button v-if="!running && phase === 'error'" class="btn ghost" type="button" @click="begin">重试</button>
        </div>

        <p v-if="notice" class="notice">{{ notice }}</p>
      </section>

      <!-- 右列：实时进度 -->
      <section class="panel progress-panel">
        <div class="panel-head">
          <span class="title">生成进度</span>
          <span v-if="running || phase === 'done'" class="count">{{ store.slideCount }} / {{ phase === 'done' ? store.slideCount : estimated }} 页</span>
        </div>

        <div class="status-line">
          <span v-if="running" class="spinner"></span>
          <span class="status-text">{{ statusText || '等待开始…' }}</span>
        </div>
        <div class="bar">
          <div class="bar-inner" :style="{ width: progress + '%' }"></div>
        </div>

        <div class="thumbs" v-if="store.slideCount">
          <div v-for="(s, i) in store.slides" :key="s.id" class="thumb" :class="{ last: i === store.slides.length - 1 && running }">
            <SlideViewer :slide="s" :width="120" flat />
            <span class="thumb-no">{{ i + 1 }}</span>
            <span class="thumb-type">{{ SLIDE_TYPE_LABELS[s.type] ?? s.type }}</span>
          </div>
          <div v-if="running" class="thumb ghost-cell">
            <div class="ghost-inner"><span class="ghost-spin"></span></div>
          </div>
        </div>
        <p v-else class="empty-tip">{{ running ? '正在生成第一页…' : '尚未生成幻灯片' }}</p>

        <div v-if="logs.length" class="log">
          <div v-for="(l, i) in logs" :key="i" class="log-line">{{ l }}</div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.generate {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.body {
  display: grid;
  grid-template-columns: minmax(300px, 5fr) minmax(360px, 6fr);
  gap: 18px;
  align-items: start;
}
.panel {
  background: #fff;
  border-radius: 16px;
  padding: 20px;
  box-shadow: 0 10px 30px rgba(30, 40, 80, 0.06);
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}
.panel-head .title {
  font-weight: 800;
  font-size: 16px;
}
.tag {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 999px;
  background: #eef0ff;
  color: #6366f1;
}
.tag.demo {
  background: #fff3e0;
  color: #c2700a;
}
.deck-title {
  font-size: 22px;
  font-weight: 800;
  color: #1d2140;
  margin: 4px 0 14px;
  line-height: 1.3;
}
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.lbl {
  color: #8a94a6;
  font-size: 13px;
}
.radio {
  font-size: 13px;
  color: #4b5563;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}
.badge {
  font-size: 12px;
  color: #6b7280;
  background: #f3f4fb;
  border-radius: 8px;
  padding: 4px 10px;
}
.badge.kb {
  color: #b45309;
  background: #fff3e0;
}
.text-btn {
  border: none;
  background: none;
  color: #6366f1;
  cursor: pointer;
  font-size: 13px;
  padding: 4px 0;
  margin-bottom: 6px;
}
.outline {
  width: 100%;
  border: 1px solid #e6e8ef;
  border-radius: 10px;
  padding: 10px;
  font-size: 13px;
  font-family: inherit;
  resize: vertical;
  outline: none;
  line-height: 1.7;
}
.actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 14px;
}
.btn {
  border: none;
  cursor: pointer;
  border-radius: 10px;
  padding: 10px 18px;
  font-size: 14px;
  font-weight: 700;
  transition: 0.15s;
}
.btn.primary {
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: #fff;
}
.btn.accent {
  background: #10b981;
  color: #fff;
}
.btn.danger {
  background: #fff1f1;
  color: #dc2626;
}
.btn.ghost {
  background: #f3f4fb;
  color: #4b5563;
}
.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.notice {
  margin-top: 12px;
  color: #b45309;
  background: #fffbeb;
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 13px;
}

.progress-panel .count {
  font-size: 13px;
  color: #6366f1;
  font-weight: 700;
}
.status-line {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 26px;
  margin-bottom: 8px;
}
.status-text {
  font-size: 14px;
  color: #334155;
  font-weight: 600;
}
.spinner {
  width: 16px;
  height: 16px;
  border: 3px solid #e6e8ff;
  border-top-color: #667eea;
  border-radius: 50%;
  animation: rot 0.8s linear infinite;
  flex: none;
}
@keyframes rot {
  to {
    transform: rotate(360deg);
  }
}
.bar {
  height: 8px;
  border-radius: 999px;
  background: #eef0f6;
  overflow: hidden;
  margin-bottom: 16px;
}
.bar-inner {
  height: 100%;
  background: linear-gradient(90deg, #667eea, #764ba2);
  border-radius: 999px;
  transition: width 0.3s ease;
}
.thumbs {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(126px, 1fr));
  gap: 14px;
  margin-bottom: 12px;
  max-height: 420px;
  overflow: auto;
  padding: 2px;
}
.thumb {
  position: relative;
  border-radius: 10px;
  overflow: hidden;
  border: 2px solid transparent;
}
.thumb.last {
  border-color: #667eea;
}
.thumb-no {
  position: absolute;
  top: 6px;
  left: 6px;
  background: rgba(15, 23, 42, 0.6);
  color: #fff;
  font-size: 11px;
  border-radius: 6px;
  padding: 1px 7px;
}
.thumb-type {
  display: block;
  text-align: center;
  font-size: 12px;
  color: #64748b;
  margin-top: 6px;
}
.ghost-cell {
  border: 2px dashed #cfd6ff;
  min-height: 88px;
  display: grid;
  place-items: center;
}
.ghost-inner {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
}
.ghost-spin {
  width: 24px;
  height: 24px;
  border: 3px solid #dfe3ff;
  border-top-color: #667eea;
  border-radius: 50%;
  animation: rot 0.9s linear infinite;
}
.empty-tip {
  color: #b6bcc9;
  font-size: 14px;
  text-align: center;
  padding: 30px 0;
}
.log {
  max-height: 120px;
  overflow: auto;
  background: #0f1220;
  border-radius: 10px;
  padding: 10px 14px;
}
.log-line {
  font-family: Consolas, Menlo, monospace;
  font-size: 12px;
  color: #b6c0ff;
  line-height: 1.8;
}
@media (max-width: 900px) {
  .body {
    grid-template-columns: 1fr;
  }
}
</style>
