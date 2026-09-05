<script setup lang="ts">
// P03 模板选择页（路由 /ppt）
// 加载模板列表 → 选择版式 → 调 AIPPT_Content(SSE) 逐页生成 → 进入 /editor
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { AIPPT_Content, AIPPTByID, getTemplates } from '../services'
import type { SlideSchema, TemplateInfo } from '../types/AIPPT'
import { useGenerationStore } from '../store/generation'
import { useDraftStore } from '../store/slides'

const router = useRouter()
const gen = useGenerationStore()
const draft = useDraftStore()

const LANGUAGES = [
  { label: '简体中文', value: '中文' },
  { label: 'English', value: 'English' },
  { label: '日本語', value: '日本語' },
]

/* ---------------- 模板列表 ---------------- */
const templates = ref<TemplateInfo[]>([])
const tplLoading = ref(true)
const tplError = ref('')

async function loadTemplates() {
  tplLoading.value = true
  tplError.value = ''
  try {
    templates.value = await getTemplates()
  } catch (e) {
    templates.value = []
    tplError.value = `模板加载失败：${(e as Error).message}`
  } finally {
    tplLoading.value = false
  }
}
onMounted(loadTemplates)

// 选中模板 id；另有「默认版式」选项（selectedId 保持 '' 但记录 choseDefault）
const selectedId = ref('')
const choseDefault = ref(false)
const chosenName = computed(() =>
  selectedId.value ? templates.value.find(t => t.id === selectedId.value)?.name ?? '' : '',
)
const sideHint = computed(() =>
  chosenName.value ? `将应用模板「${chosenName.value}」` : '将使用默认版式',
)
function pickTemplate(id: string) {
  selectedId.value = id
  choseDefault.value = false
}
function pickDefault() {
  selectedId.value = ''
  choseDefault.value = true
}

/* ---------------- 配置与大纲摘要 ---------------- */
const language = ref(gen.language)
// 信息来源：none=不检索 / web=联网检索 / file=上传资料（后端按已入库文件做知识库检索）
const infoSrc = ref<'none' | 'web' | 'file'>('none')
const hasUploadedFile = computed(() => Boolean(gen.fileId))

const markdown = computed(() => gen.markdown)
const hasOutline = computed(() => markdown.value.trim().length > 0)

const outlineStats = computed(() => {
  let sections = 0
  let points = 0
  for (const line of markdown.value.split(/\r?\n/)) {
    const t = line.trim()
    if (/^#{1,6}\s+/.test(t)) sections++
    else if (/^([-*+]|\d{1,3}[.、)．])\s+/.test(t)) points++
  }
  return { sections, points }
})

const preview = computed(() => {
  const md = markdown.value.trim()
  return md.length > 160 ? md.slice(0, 160) + '…' : md
})

function chooseLanguage(v: string) {
  language.value = v
  gen.setParams({ language: v })
}

/** 切换信息来源；「上传资料」需先在本会话录入页上传过文档（有 fileId）。 */
function pickInfo(v: 'none' | 'web' | 'file') {
  if (v === 'file' && !hasUploadedFile.value) return
  infoSrc.value = v
}

/* ---------------- 内容生成 ---------------- */
const generating = ref(false)
const slideCount = ref(0)
const errMsg = ref('')

// 有可用模板时必须显式选择模板或「默认版式」；无模板（空/加载失败）时直接允许默认版式
const hasTemplates = computed(() => templates.value.length > 0)
const selectionMade = computed(() => selectedId.value !== '' || choseDefault.value)
const canGenerate = computed(() => {
  if (generating.value) return false
  const selectionOK = hasTemplates.value ? selectionMade.value : true
  // 上传资料路径由后端按 fileId 取文档生成，不再依赖本页大纲
  if (infoSrc.value === 'file') return hasUploadedFile.value && selectionOK
  return hasOutline.value && selectionOK
})

async function generate() {
  if (generating.value || !hasOutline.value) return
  errMsg.value = ''
  generating.value = true
  slideCount.value = 0

  draft.reset()
  draft.setMeta({ templateId: selectedId.value })

  const addSlide = (slide: SlideSchema) => {
    draft.pushSchema(slide)
    slideCount.value++
  }

  try {
    if (infoSrc.value === 'file' && hasUploadedFile.value) {
      // 上传资料：走后端 /tools/aippt_by_id，从知识库按 fileId 取文档检索生成
      await AIPPTByID(gen.fileId, { userId: gen.userId }, addSlide)
    } else {
      // 文本大纲（不检索 / 联网检索）：全部交给后端 /tools/aippt
      await AIPPT_Content(
        markdown.value,
        {
          language: language.value,
          generateFromWebSearch: infoSrc.value === 'web',
        },
        addSlide,
      )
    }
    router.push('/editor')
  } catch (e) {
    errMsg.value = `内容生成失败：${(e as Error).message}（已生成 ${slideCount.value} 页）`
  } finally {
    generating.value = false
  }
}
</script>

<template>
  <section class="page">
    <!-- 步骤条：P03 当前 -->
    <div class="stepbar">
      <router-link class="step" to="/"><i>1</i> 主题录入</router-link>
      <span class="line"></span>
      <router-link class="step" to="/outline"><i>2</i> 大纲编辑</router-link>
      <span class="line"></span>
      <div class="step active"><i>3</i> 选择模板</div>
    </div>

    <!-- 工具条 -->
    <div class="card toolbar">
      <button class="btn ghost back" @click="router.push('/outline')">← 编辑大纲</button>
      <div class="tool-title">
        <h1>选择模板</h1>
        <span class="count">{{ templates.length }} 套可选模板</span>
      </div>
    </div>

    <!-- 模板列表三态 -->
    <div class="card">
      <p class="hint">挑选一份版式风格，AI 将按你编辑好的大纲逐页填充内容。</p>

      <!-- loading：骨架 -->
      <div v-if="tplLoading" class="grid">
        <div v-for="i in 6" :key="i" class="tpl skeleton"></div>
      </div>

      <!-- 加载失败 -->
      <div v-else-if="tplError" class="notice">
        <p class="notice-msg">{{ tplError }}</p>
        <div class="notice-actions">
          <button class="btn ghost" @click="loadTemplates">重新加载</button>
          <button class="btn primary" @click="pickDefault()">使用默认版式继续 →</button>
        </div>
      </div>

      <!-- 空列表 -->
      <div v-else-if="!templates.length" class="notice">
        <p class="notice-msg">后端暂未提供可用模板，可先用默认版式生成，之后再替换模板。</p>
        <div class="notice-actions">
          <button class="btn primary" @click="pickDefault()">使用默认版式继续 →</button>
        </div>
      </div>

      <!-- 正常列表 -->
      <template v-else>
        <div class="grid">
          <button
            v-for="t in templates"
            :key="t.id"
            class="tpl"
            :class="{ on: selectedId === t.id }"
            @click="pickTemplate(t.id)"
          >
            <span class="cover">
              <img v-if="t.cover" :src="t.cover" :alt="t.name" />
              <span v-else class="cover-ph">{{ t.name.slice(0, 1) }}</span>
              <span v-if="selectedId === t.id" class="check">✓</span>
            </span>
            <span class="name">{{ t.name }}</span>
          </button>
        </div>
        <button class="linklike" :class="{ chosen: choseDefault }" @click="pickDefault()">
          {{ choseDefault ? '✓ 不使用模板（默认版式）' : '不使用模板（默认版式）' }}
        </button>
      </template>
    </div>

    <!-- 配置面板 -->
    <div class="card panel">
      <div class="panel-left">
        <p class="field-label">大纲</p>
        <div v-if="hasOutline" class="outline-box">
          <p class="outline-stats">
            <strong>{{ outlineStats.sections }}</strong> 个章节 ·
            <strong>{{ outlineStats.points }}</strong> 个要点 · 共 {{ markdown.length }} 字
          </p>
          <pre class="outline-preview">{{ preview }}</pre>
        </div>
        <div v-else class="outline-empty">
          <p>还没有大纲，无法生成内容。</p>
          <div class="notice-actions">
            <router-link class="btn ghost" to="/">去录入主题</router-link>
            <router-link class="btn primary" to="/outline">编辑已有大纲 →</router-link>
          </div>
        </div>

        <p class="field-label">生成设置</p>
        <div class="settings">
          <div class="setting">
            <span class="setting-name">信息来源</span>
            <div class="seg">
              <button :class="{ on: infoSrc === 'none' }" :disabled="generating" @click="infoSrc = 'none'">不检索</button>
              <button :class="{ on: infoSrc === 'web' }" :disabled="generating" @click="infoSrc = 'web'">联网检索</button>
              <button
                :class="{ on: infoSrc === 'file' }"
                :disabled="generating || !hasUploadedFile"
                :title="hasUploadedFile ? '基于已上传文档由后端检索生成' : '需先在录入页上传文档'"
                @click="pickInfo('file')"
              >
                上传资料
              </button>
            </div>
            <p v-if="infoSrc === 'file'" class="file-note">
              {{ hasUploadedFile ? `将基于已上传文档「${gen.fileName}」由后端检索生成` : '尚未上传文档，请先到录入页选择「上传文档」' }}
            </p>
          </div>
          <div class="setting">
            <label class="setting-name" for="lang">内容语言</label>
            <select id="lang" :value="language" class="select" :disabled="generating" @change="chooseLanguage(($event.target as HTMLSelectElement).value)">
              <option v-for="l in LANGUAGES" :key="l.value" :value="l.value">{{ l.label }}</option>
            </select>
          </div>
        </div>
      </div>

      <div class="panel-right">
        <button class="btn primary big" :disabled="!canGenerate" @click="generate">
          {{
            generating
              ? `⏳ 正在生成内容…（已生成 ${slideCount} 页）`
              : '✨ 生成演示文稿'
          }}
        </button>
        <p class="side-hint">
          {{ sideHint }}，生成完成后自动进入编辑器。
        </p>
      </div>
    </div>

    <p v-if="errMsg" class="error">{{ errMsg }}</p>
  </section>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
/* 步骤条 */
.stepbar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: #8a94a6;
  font-size: 13px;
}
.step {
  display: flex;
  align-items: center;
  gap: 6px;
  text-decoration: none;
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
  width: 44px;
  height: 2px;
  background: #dfe3ee;
  border-radius: 2px;
}

.card {
  background: #fff;
  border-radius: 14px;
  padding: 22px 28px;
  box-shadow: 0 10px 30px rgba(30, 40, 80, 0.08);
}
h1 {
  font-size: 19px;
}
.hint {
  color: #8a94a6;
  font-size: 13px;
  margin: 4px 0 16px;
}
.btn {
  border: none;
  cursor: pointer;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  padding: 10px 18px;
  text-decoration: none;
  display: inline-block;
  text-align: center;
}
.btn.primary {
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: #fff;
}
.btn.primary:hover:not(:disabled) {
  filter: brightness(1.06);
}
.btn.ghost {
  background: #fff;
  color: #4f46e5;
  border: 1px solid #c7d0f4;
}
.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.error {
  margin-top: 4px;
  color: #dc2626;
  font-size: 13px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  padding: 10px 12px;
}

/* 工具条 */
.toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
}
.back {
  font-weight: 500;
}
.tool-title {
  flex: 1;
}
.tool-title .count {
  color: #8a94a6;
  font-size: 13px;
  font-weight: 400;
}

/* 模板网格 */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
}
.tpl {
  border: 2px solid #e6e8ef;
  border-radius: 12px;
  overflow: hidden;
  background: #fff;
  cursor: pointer;
  padding: 0;
  text-align: left;
  font-family: inherit;
  transition: 0.15s;
}
.tpl:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 20px rgba(30, 40, 80, 0.12);
}
.tpl.on {
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.28);
}
.cover {
  position: relative;
  display: block;
  aspect-ratio: 16 / 9;
  background: linear-gradient(135deg, #eceefe, #e6d9f3);
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.cover-ph {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 40px;
  font-weight: 800;
  color: rgba(102, 126, 234, 0.5);
}
.check {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: #fff;
  font-size: 14px;
  display: grid;
  place-items: center;
}
.name {
  display: block;
  padding: 10px 12px;
  font-size: 14px;
  color: #1f2430;
}
.tpl.skeleton {
  height: 168px;
  border: none;
  background: linear-gradient(100deg, #f0f1f7 40%, #e2e6f1 50%, #f0f1f7 60%);
  background-size: 200% 100%;
  animation: shimmer 1.2s infinite;
  cursor: default;
}
@keyframes shimmer {
  to {
    background-position: -200% 0;
  }
}
.linklike {
  margin-top: 14px;
  border: none;
  background: none;
  color: #8a94a6;
  font-size: 13px;
  cursor: pointer;
  text-decoration: underline dotted;
}
.linklike:hover {
  color: #4f46e5;
}
.linklike.chosen {
  color: #4f46e5;
  font-weight: 600;
}

/* 提示块 */
.notice {
  background: #f8f9fd;
  border: 1px dashed #d5daf0;
  border-radius: 12px;
  padding: 22px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 14px;
}
.notice-msg {
  color: #55627c;
  font-size: 14px;
}
.notice-actions {
  display: flex;
  gap: 10px;
}

/* 配置面板 */
.panel {
  display: flex;
  gap: 24px;
  flex-wrap: wrap;
}
.panel-left {
  flex: 1;
  min-width: 260px;
}
.field-label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: #4b5563;
  margin: 14px 0 8px;
}
.outline-box {
  background: #f7f8fc;
  border-radius: 10px;
  padding: 12px 14px;
}
.outline-stats {
  font-size: 13px;
  color: #55627c;
  margin-bottom: 6px;
}
.outline-stats strong {
  color: #4f46e5;
}
.outline-preview {
  white-space: pre-wrap;
  font-size: 13px;
  line-height: 1.6;
  color: #6b7280;
  max-height: 120px;
  overflow: auto;
}
.outline-empty p {
  color: #b6bcc9;
  font-size: 14px;
  margin-bottom: 12px;
}
.settings {
  display: flex;
  gap: 28px;
  flex-wrap: wrap;
  align-items: flex-start;
}
.setting {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.setting-name {
  font-size: 13px;
  color: #55627c;
}
.file-note {
  font-size: 12px;
  color: #8a94a6;
  max-width: 320px;
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
  padding: 7px 14px;
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
.seg button.disabled,
.seg button:disabled {
  color: #b6bcc9;
  cursor: not-allowed;
  background: transparent;
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
.panel-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: center;
  gap: 10px;
  min-width: 220px;
}
.btn.big {
  font-size: 16px;
  padding: 14px 30px;
  width: 100%;
  max-width: 280px;
}
.side-hint {
  font-size: 12px;
  color: #8a94a6;
  text-align: center;
  max-width: 280px;
}
</style>
