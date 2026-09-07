<script setup lang="ts">
// P01 主题录入页（路由 /）
// 输入演示主题/文档内容 → 流式生成大纲（AIPPT_Outline / AIPPT_Outline_From_File）→ 跳转 /outline
import { onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { AIPPT_Outline, AIPPT_Outline_From_File } from '../services'
import { useGenerationStore, type GenSource } from '../store/generation'
import StepBar from '../components/StepBar.vue'

const router = useRouter()
const gen = useGenerationStore()

const RECOMMENDED = [
  'AI 大模型行业趋势报告',
  '2026 年新媒体营销策略',
  '公司年中总结与下半年规划',
  '新能源汽车竞争格局分析',
  '如何用 AI 提升办公效率',
  'AI 赋能企业的落地方案',
  '季度经营分析与年度规划',
]

const LANGUAGES = [
  { label: '简体中文', value: '中文' },
  { label: 'English', value: 'English' },
  { label: '日本語', value: '日本語' },
]
const MODELS = ['qwen-turbo-latest', 'qwen-plus-latest', 'deepseek-v3']

// 与 store 同步：返回本页时回填上次录入
const topic = ref(gen.topic)
const language = ref(gen.language)
const model = ref(gen.model)
const source = ref<GenSource>(gen.source)

const pickedFile = ref<File | null>(null)
const loading = ref(false)
const done = ref(false)
const errMsg = ref('')
const streamText = ref('')

function pickTopic(suggestion: string) {
  // 拖拽滚动后松开触发的 click 不应误选中主题
  if (suppressClick.value) {
    suppressClick.value = false
    return
  }
  topic.value = suggestion
}

/* ---------- 推荐主题横向滚动（滚轮 / 拖拽 / 左右箭头） ---------- */
const chipsRow = ref<HTMLElement | null>(null)
const canLeft = ref(false)
const canRight = ref(false)
const suppressClick = ref(false)

let drag = { active: false, startX: 0, startLeft: 0, maxDx: 0 }

function updateChipsArrows() {
  const el = chipsRow.value
  if (!el) return
  canLeft.value = el.scrollLeft > 1
  canRight.value = el.scrollLeft < el.scrollWidth - el.clientWidth - 1
}

function scrollChipsBy(dir: -1 | 1) {
  chipsRow.value?.scrollBy({ left: dir * 240, behavior: 'smooth' })
}

/** 纵向滚轮 → 横向滚动；仅在内容可横向溢出时拦截，否则交给页面垂直滚动。 */
function onChipsWheel(e: WheelEvent) {
  const el = chipsRow.value
  if (!el || el.scrollWidth <= el.clientWidth) return
  const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
  el.scrollLeft += delta
  updateChipsArrows()
  e.preventDefault()
}

function onChipsPointerDown(e: PointerEvent) {
  const el = chipsRow.value
  if (!el) return
  drag = { active: true, startX: e.clientX, startLeft: el.scrollLeft, maxDx: 0 }
}

function onChipsPointerMove(e: PointerEvent) {
  if (!drag.active) return
  const el = chipsRow.value
  if (!el) return
  const dx = e.clientX - drag.startX
  drag.maxDx = Math.max(drag.maxDx, Math.abs(dx))
  el.scrollLeft = drag.startLeft - dx
}

function endChipsDrag() {
  if (!drag.active) return
  if (drag.maxDx > 5) suppressClick.value = true // 有拖动则吞掉随后的 click
  drag.active = false
}

onMounted(() => {
  const el = chipsRow.value
  if (!el) return
  el.addEventListener('wheel', onChipsWheel, { passive: false })
  el.addEventListener('scroll', updateChipsArrows, { passive: true })
  window.addEventListener('resize', updateChipsArrows)
  updateChipsArrows()
})
onUnmounted(() => {
  const el = chipsRow.value
  if (!el) return
  el.removeEventListener('wheel', onChipsWheel)
  el.removeEventListener('scroll', updateChipsArrows)
  window.removeEventListener('resize', updateChipsArrows)
})

function onPickFile(e: Event) {
  const input = e.target as HTMLInputElement | null
  pickedFile.value = input?.files?.[0] ?? null
}

function clearAll() {
  topic.value = ''
  pickedFile.value = null
  streamText.value = ''
  done.value = false
  errMsg.value = ''
  gen.clearUploadedFile()
}

/** 生成一次上传会话的唯一 fileId（后端按 userId + fileId 入库 / 检索）。 */
function nextFileId(): string {
  return `file_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

async function generate() {
  if (loading.value) return
  errMsg.value = ''
  streamText.value = ''
  done.value = false

  if (source.value === 'text' && !topic.value.trim()) {
    errMsg.value = '请先输入演示主题或粘贴文档内容。'
    return
  }
  if (source.value === 'file' && !pickedFile.value) {
    errMsg.value = '请选择要上传的文档（.txt / .md / .pdf 等）。'
    return
  }

  loading.value = true
  gen.setBusy(true) // 流式生成期间全局锁定跳转（顶栏/步骤条灰化 + 路由守卫拦截）
  try {
    let full = ''
    let uploaded: { fileId: string; fileName: string } | null = null
    if (source.value === 'file' && pickedFile.value) {
      // 上传文件生成大纲：随表单带上 userId/fileId，让后端把该文件入库，
      // 记录 fileId 供 P03 选「上传资料」时按文件检索生成。
      const fileId = nextFileId()
      full = await AIPPT_Outline_From_File(
        pickedFile.value,
        { userId: gen.userId, fileId, language: language.value },
        (chunk) => {
          streamText.value += chunk
        },
      )
      uploaded = { fileId, fileName: pickedFile.value.name }
    } else {
      full = await AIPPT_Outline(topic.value, language.value, model.value, (chunk) => {
        streamText.value += chunk
      })
    }
    if (!full.trim()) {
      throw new Error('后端未返回任何大纲内容，请确认后端服务已启动且 .env 中已配置模型 Key')
    }
    gen.setTopic(topic.value)
    gen.setParams({ language: language.value, model: model.value, source: source.value })
    gen.setMarkdown(full)
    if (uploaded) gen.setUploadedFile(uploaded.fileId, uploaded.fileName)
    else gen.clearUploadedFile()
    done.value = true
  } catch (e) {
    errMsg.value = `生成失败：${(e as Error).message}`
  } finally {
    loading.value = false
    gen.setBusy(false) // 无论成功/失败都要解锁，允许继续跳转
  }
}

// 离线演示兜底：不经后端，塞入示例大纲直接进入编辑页
const SAMPLE_MARKDOWN = `# AI 大模型行业趋势报告

## 一、行业概述
- 大模型进入应用落地阶段
- 全球市场规模与增速

## 二、核心技术突破
- 长上下文与多模态能力
- 推理成本持续下降

## 三、产业生态格局
- 基础大模型厂商的竞争
- 开源与闭源路线并存

## 四、行业应用案例
- 办公与内容创作
- 教育与医疗场景

## 五、未来趋势与展望
- Agent 工作流成为主流
- 端侧小模型逐步兴起`

function useSample() {
  gen.setTopic(topic.value || 'AI 大模型行业趋势报告')
  gen.setParams({ language: language.value, model: model.value, source: 'text' })
  gen.setMarkdown(SAMPLE_MARKDOWN)
  gen.clearUploadedFile() // 载入示例 = 放弃文档库路径
  router.push('/outline')
}
</script>

<template>
  <section class="page">
    <StepBar :current="1" />

    <div class="card">
      <div class="head">
        <div>
          <h1>你要做一个什么样的 PPT？</h1>
          <p class="hint">输入一句话主题，或粘贴一篇文档内容，AI 会先生成一份大纲供你修改。</p>
        </div>
      </div>

      <!-- 主题输入 -->
      <label class="field-label" for="topic">演示主题 / 内容</label>
      <textarea
        id="topic"
        v-model="topic"
        rows="6"
        maxlength="5000"
        placeholder="例如：给公司管理层讲一讲 2026 年 AI 办公的发展机会……"
      ></textarea>
      <div class="meta-row">
        <div class="chips">
          <button
            type="button"
            class="scroll-btn"
            :disabled="!canLeft"
            aria-label="向左滑动"
            @click="scrollChipsBy(-1)"
          >
            ‹
          </button>
          <div
            ref="chipsRow"
            class="chips-row"
            @pointerdown="onChipsPointerDown"
            @pointermove="onChipsPointerMove"
            @pointerup="endChipsDrag"
            @pointerleave="endChipsDrag"
          >
            <span v-for="s in RECOMMENDED" :key="s" class="chip" @click="pickTopic(s)">💡 {{ s }}</span>
          </div>
          <button
            type="button"
            class="scroll-btn"
            :disabled="!canRight"
            aria-label="向右滑动"
            @click="scrollChipsBy(1)"
          >
            ›
          </button>
        </div>
        <span class="count">{{ topic.length }} / 5000</span>
      </div>

      <!-- 来源：文本 / 上传文件 -->
      <div class="field-label">大纲来源</div>
      <div class="source-row">
        <button type="button" class="src-card" :class="{ on: source === 'text' }" @click="source = 'text'">
          <span class="src-title">✍️ 直接生成</span>
          <span class="src-desc">按上面的主题 / 文本让 AI 起草大纲</span>
        </button>
        <button type="button" class="src-card" :class="{ on: source === 'file' }" @click="source = 'file'">
          <span class="src-title">📄 上传文档</span>
          <span class="src-desc">解析已有文档，据此生成大纲</span>
        </button>
      </div>

      <div v-if="source === 'file'" class="file-box">
        <label class="file-btn">
          <span>{{ pickedFile ? `已选择：${pickedFile.name}` : '选择文件（.txt / .md / .pdf …）' }}</span>
          <input type="file" accept=".txt,.md,.markdown,.pdf,.doc,.docx" hidden @change="onPickFile" />
        </label>
      </div>

      <!-- 生成参数 -->
      <div class="params">
        <div class="field">
          <span class="field-label">演示语言</span>
          <div class="seg">
            <button
              v-for="l in LANGUAGES"
              :key="l.value"
              type="button"
              :class="{ on: language === l.value }"
              @click="language = l.value"
            >
              {{ l.label }}
            </button>
          </div>
        </div>
        <div class="field">
          <label class="field-label" for="model">生成模型</label>
          <select id="model" v-model="model" class="select">
            <option v-for="m in MODELS" :key="m" :value="m">{{ m }}</option>
          </select>
        </div>
      </div>

      <!-- 操作 -->
      <div class="actions">
        <button class="btn primary" :disabled="loading" @click="generate">
          {{ loading ? '⏳ 正在生成大纲…' : source === 'file' ? '从文档生成大纲' : '✨ AI 生成大纲' }}
        </button>
        <button class="btn ghost" :disabled="loading" @click="useSample">载入示例大纲</button>
        <button v-if="topic || pickedFile || streamText" class="btn text-btn" :disabled="loading" @click="clearAll">
          清空
        </button>
      </div>

      <p v-if="errMsg" class="error">{{ errMsg }}</p>

      <!-- 流式输出 / 成功态 -->
      <div v-if="loading || streamText || done" class="output-wrap">
        <div class="output-head">
          <span>{{ done ? '✅ 大纲已生成' : '⏳ 正在流式生成…' }}</span>
          <span v-if="done" class="ok-note">共 {{ streamText.length }} 字</span>
        </div>
        <pre class="output">{{ streamText || '（等待内容…）' }}</pre>
        <router-link v-if="done" class="btn primary next" to="/outline">查看并编辑大纲 →</router-link>
      </div>
    </div>
  </section>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.card {
  background: #fff;
  border-radius: 14px;
  padding: 28px;
  box-shadow: 0 10px 30px rgba(30, 40, 80, 0.08);
}
.head h1 {
  font-size: 22px;
}
.hint {
  color: #8a94a6;
  font-size: 13px;
  margin: 6px 0 18px;
}
.field-label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: #4b5563;
  margin: 16px 0 8px;
}
#topic {
  width: 100%;
  border: 1px solid #e6e8ef;
  border-radius: 10px;
  padding: 12px;
  font-size: 15px;
  font-family: inherit;
  resize: vertical;
  outline: none;
}
#topic:focus {
  border-color: #667eea;
}
.meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 10px;
}
.chips {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
}
.chips-row {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  overflow-x: auto;
  scrollbar-width: none; /* Firefox 隐藏滚动条 */
  padding: 2px 1px;
  cursor: grab;
  user-select: none;
  touch-action: pan-y;
}
.chips-row::-webkit-scrollbar {
  display: none;
}
.chips-row:active {
  cursor: grabbing;
}
.scroll-btn {
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 1px solid #e3e7f2;
  background: #fff;
  color: #55627c;
  font-size: 16px;
  line-height: 1;
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: 0.15s;
}
.scroll-btn:hover:not(:disabled) {
  border-color: #667eea;
  color: #4f46e5;
}
.scroll-btn:disabled {
  opacity: 0.35;
  cursor: default;
}
.chip {
  flex: 0 0 auto;
  white-space: nowrap;
  background: #f1f3fa;
  border: 1px solid #e3e7f2;
  color: #55627c;
  font-size: 13px;
  padding: 5px 12px;
  border-radius: 999px;
  cursor: pointer;
  transition: 0.15s;
}
.chip:hover {
  background: #e7ebfb;
  color: #4f46e5;
}
.count {
  color: #b6bcc9;
  font-size: 12px;
  white-space: nowrap;
}
.source-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.src-card {
  text-align: left;
  border: 1px solid #e6e8ef;
  background: #fbfcfe;
  border-radius: 12px;
  padding: 14px 16px;
  cursor: pointer;
  transition: 0.15s;
  font-family: inherit;
}
.src-card .src-title {
  display: block;
  font-size: 15px;
  font-weight: 600;
  color: #1f2430;
}
.src-card .src-desc {
  display: block;
  font-size: 12px;
  color: #8a94a6;
  margin-top: 4px;
}
.src-card.on {
  border-color: #667eea;
  background: #eef0fe;
  box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.25);
}
.file-box {
  margin-top: 12px;
}
.file-btn {
  display: inline-block;
  border: 1px dashed #c3cad9;
  background: #fbfcfe;
  border-radius: 10px;
  padding: 14px 18px;
  cursor: pointer;
  font-size: 13px;
  color: #55627c;
}
.file-btn:hover {
  border-color: #667eea;
  color: #4f46e5;
}
.params {
  display: flex;
  gap: 32px;
  flex-wrap: wrap;
  align-items: flex-start;
  margin-top: 4px;
}
.seg {
  display: inline-flex;
  background: #f1f3fa;
  border-radius: 10px;
  padding: 3px;
}
.seg button {
  border: none;
  background: transparent;
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 13px;
  color: #55627c;
  cursor: pointer;
}
.seg button.on {
  background: #fff;
  color: #4f46e5;
  font-weight: 600;
  box-shadow: 0 1px 4px rgba(30, 40, 80, 0.12);
}
.select {
  border: 1px solid #e6e8ef;
  border-radius: 8px;
  padding: 7px 10px;
  font-size: 13px;
  background: #fff;
  color: #1f2430;
  outline: none;
}
.actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 22px;
}
.btn {
  border: none;
  cursor: pointer;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  padding: 11px 22px;
}
.btn.primary {
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: #fff;
  box-shadow: 0 4px 14px rgba(102, 126, 234, 0.35);
}
.btn.primary:hover:not(:disabled) {
  filter: brightness(1.06);
}
.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.btn.ghost {
  background: #fff;
  color: #4f46e5;
  border: 1px solid #c7d0f4;
}
.btn.text-btn {
  background: transparent;
  color: #8a94a6;
  font-weight: 400;
}
.error {
  margin-top: 14px;
  color: #dc2626;
  font-size: 13px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  padding: 10px 12px;
}
.output-wrap {
  margin-top: 18px;
  border-top: 1px dashed #e6e8ef;
  padding-top: 14px;
}
.output-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  font-weight: 600;
  color: #4f46e5;
  margin-bottom: 8px;
}
.ok-note {
  color: #16a34a;
}
.output {
  background: #f7f8fc;
  border-radius: 10px;
  padding: 14px;
  min-height: 90px;
  max-height: 320px;
  overflow: auto;
  white-space: pre-wrap;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 13px;
  line-height: 1.7;
}
.next {
  display: inline-block;
  margin-top: 12px;
  text-decoration: none;
}
</style>
