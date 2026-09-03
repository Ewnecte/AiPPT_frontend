<script setup lang="ts">
// P08 知识库 / 系统设置页
// 三个 Tab：① 知识库文件列表 ② 系统配置（模型供应商 / Embedding） ③ 服务状态。
//
// 后端接入位置（供接口联调时替换，注释不进界面）：
//  ① 文件列表：kbFiles / 上传 / 重建 / 删除 → personaldb 的 GET /files/{user_id}、POST /upload、DELETE /files/{file_id}
//  ② 配置保存：saveAllConfig → 系统配置读写接口（当前为 localStorage 占位）
//  ③ 服务状态：services 数组 → 各服务 GET /healthz
import { ref, reactive, computed } from 'vue'

/* ================= 通用轻量 toast ================= */
interface Toast {
  id: number
  text: string
  type: 'success' | 'warn'
}
const toasts = ref<Toast[]>([])
let toastSeq = 0
function showToast(text: string, type: 'success' | 'warn' = 'success') {
  const id = ++toastSeq
  toasts.value.push({ id, text, type })
  window.setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }, 2600)
}

/* ================= Tab ================= */
type Tab = 'files' | 'config' | 'status'
const tab = ref<Tab>('files')

/* ================= ① 知识库文件列表 ================= */
interface KbFile {
  id: number
  name: string
  type: string
  size: string
  chunks: number
  updatedAt: string
  status: 'ready' | 'indexing'
}
const kbFiles = ref<KbFile[]>([
  { id: 1, name: '2026-新能源汽车市场周报.md', type: 'md', size: '18 KB', chunks: 24, updatedAt: '2026-08-20 10:12', status: 'ready' },
  { id: 2, name: '产品白皮书-第4版.pdf', type: 'pdf', size: '2.4 MB', chunks: 186, updatedAt: '2026-08-18 09:00', status: 'ready' },
  { id: 3, name: '竞品深度分析.pptx', type: 'pptx', size: '6.1 MB', chunks: 96, updatedAt: '2026-08-15 16:40', status: 'ready' },
  { id: 4, name: '用户访谈纪要-上海场.docx', type: 'docx', size: '420 KB', chunks: 38, updatedAt: '2026-08-02 11:22', status: 'indexing' },
])
const kbKeyword = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const filteredFiles = computed(() =>
  kbFiles.value.filter((f) => f.name.toLowerCase().includes(kbKeyword.value.toLowerCase())),
)

function triggerUpload() {
  fileInput.value?.click()
}
function onUpload(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  if (f) {
    const ext = f.name.includes('.') ? f.name.split('.').pop()!.toLowerCase() : 'file'
    const row: KbFile = {
      id: Date.now(),
      name: f.name,
      type: ext,
      size: f.size > 1024 * 1024 ? `${(f.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(f.size / 1024))} KB`,
      chunks: 0,
      updatedAt: '刚刚',
      status: 'indexing',
    }
    kbFiles.value.unshift(row)
    showToast(`已接收「${f.name}」，开始解析并向量化`)
    // 模拟解析完成；接入后端后在成功回调里更新该文件状态即可
    window.setTimeout(() => {
      row.status = 'ready'
      row.chunks = Math.round(Math.random() * 200 + 20)
      showToast(`「${row.name}」向量化完成`)
    }, 1600)
  }
  input.value = ''
}
function removeFile(id: number) {
  const t = kbFiles.value.find((f) => f.id === id)
  kbFiles.value = kbFiles.value.filter((f) => f.id !== id)
  showToast(`已删除「${t?.name ?? ''}」`, 'warn')
}
// 注：删除此处仅操作本地列表，接入后端后需同步调用 DELETE 接口
function reindexFile(id: number) {
  const t = kbFiles.value.find((f) => f.id === id)
  if (!t) return
  t.status = 'indexing'
  showToast(`正在对「${t.name}」重新分块向量化`)
  window.setTimeout(() => {
    t.status = 'ready'
    t.chunks = t.chunks || Math.round(Math.random() * 200 + 20)
    showToast(`「${t.name}」向量化完成`)
  }, 1200)
}
function previewFile(name: string) {
  showToast(`已打开「${name}」的解析详情`)
}
function refreshFiles() {
  showToast('已刷新文件列表')
}

/* ================= ② 系统配置 ================= */
const LS = {
  outline: 'aippt:cfg:outline',
  content: 'aippt:cfg:content',
  embed: 'aippt:cfg:embed',
}
interface AiConfig {
  provider: string
  model: string
  apiKey: string
  baseUrl: string
}
function loadCfg(key: string, fallback: AiConfig): AiConfig {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return { ...fallback, ...(JSON.parse(raw) as Partial<AiConfig>) }
  } catch {
    return fallback
  }
}
function saveCfg(key: string, cfg: AiConfig) {
  localStorage.setItem(key, JSON.stringify(cfg))
}

const LLM_PROVIDERS = [
  { value: 'aliyun', label: '阿里云 · 通义千问' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'claude', label: 'Anthropic Claude' },
  { value: 'google', label: 'Google Gemini' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'glm', label: '智谱 GLM' },
  { value: 'doubao', label: '火山引擎 · 豆包' },
  { value: 'silicon', label: '硅基流动 SiliconFlow' },
  { value: 'modelscope', label: '魔搭 ModelScope' },
  { value: 'vllm', label: '本地 vLLM' },
  { value: 'ollama', label: '本地 Ollama' },
]
const EMBED_PROVIDERS = [
  { value: 'aliyun', label: '阿里云 DashVector' },
  { value: 'doubao', label: '火山引擎' },
  { value: 'vllm', label: '本地 vLLM' },
  { value: 'xinference', label: '本地 XInference' },
  { value: 'ollama', label: '本地 Ollama' },
]
const LLM_MODELS: Record<string, string[]> = {
  aliyun: ['qwen-turbo-latest', 'qwen-plus-latest', 'qwen-max-latest'],
  openai: ['gpt-4o', 'gpt-4o-mini'],
  claude: ['claude-sonnet-5', 'claude-haiku-4-5-20251001'],
  google: ['gemini-2.0-flash', 'gemini-2.5-pro'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  glm: ['glm-4-plus', 'glm-4-flash'],
  doubao: ['doubao-pro-32k', 'doubao-lite-32k'],
  silicon: ['Qwen/Qwen2.5-72B-Instruct', 'deepseek-ai/DeepSeek-V3'],
  modelscope: ['qwen-plus', 'deepseek-v3'],
  vllm: ['local-model'],
  ollama: ['qwen2.5:14b', 'llama3.1:8b'],
}
const EMBED_MODELS: Record<string, string[]> = {
  aliyun: ['text-embedding-v3', 'text-embedding-v2'],
  doubao: ['doubao-embedding-large', 'doubao-embedding-text-240715'],
  vllm: ['BAAI/bge-large-zh-v1.5'],
  xinference: ['bge-large-zh-v1.5'],
  ollama: ['nomic-embed-text'],
}

const outlineCfg = reactive<AiConfig>(
  loadCfg(LS.outline, { provider: 'aliyun', model: 'qwen-turbo-latest', apiKey: '', baseUrl: '' }),
)
const contentCfg = reactive<AiConfig>(
  loadCfg(LS.content, { provider: 'aliyun', model: 'qwen-turbo-latest', apiKey: '', baseUrl: '' }),
)
const embedCfg = reactive<AiConfig>(
  loadCfg(LS.embed, { provider: 'aliyun', model: 'text-embedding-v3', apiKey: '', baseUrl: '' }),
)
const nonStream = ref(true) // 内容 LLM 非流式，避免 JSON 粘连

const reveal = reactive({ outline: false, content: false, embed: false })

function syncModel(cfg: AiConfig, map: Record<string, string[]>) {
  const first = map[cfg.provider]?.[0]
  if (first) cfg.model = first
}
function modelOptions(cfg: AiConfig, map: Record<string, string[]>): string[] {
  const arr = map[cfg.provider] ?? []
  return arr.includes(cfg.model) ? arr : cfg.model ? [cfg.model, ...arr] : arr
}
function testConn(name: string) {
  showToast(`已向「${name}」发起测试请求`)
  window.setTimeout(() => showToast(`「${name}」连接成功，响应正常`), 900)
}
function saveAllConfig() {
  saveCfg(LS.outline, { ...outlineCfg })
  saveCfg(LS.content, { ...contentCfg })
  saveCfg(LS.embed, { ...embedCfg })
  showToast('配置已保存')
}

/* ================= ③ 服务状态 ================= */
type SvcStatus = 'online' | 'offline' | 'checking'
interface Svc {
  name: string
  role: string
  addr: string
  status: SvcStatus
  latency: number | null
}
const services = ref<Svc[]>([
  { name: '前端服务', role: 'Vue3 开发服务器', addr: '127.0.0.1:5173', status: 'online', latency: 2 },
  { name: '主 API 网关', role: '统一入口 / SSE 封装', addr: '127.0.0.1:6800', status: 'online', latency: 24 },
  { name: '大纲生成 Agent', role: 'A2A · simpleOutline', addr: '127.0.0.1:10001', status: 'online', latency: 187 },
  { name: '内容生成 Agent', role: 'A2A · slide_agent', addr: '127.0.0.1:10011', status: 'online', latency: 342 },
  { name: '知识库服务', role: 'ChromaDB · personaldb', addr: '127.0.0.1:9100', status: 'offline', latency: null },
])
const onlineCount = computed(() => services.value.filter((s) => s.status === 'online').length)
const overallOk = computed(() => onlineCount.value === services.value.length)

function healthCheck(svc: Svc) {
  svc.status = 'checking'
  window.setTimeout(() => {
    svc.status = 'online'
    svc.latency = Math.round(Math.random() * 400 + 8)
    showToast(`「${svc.name}」健康检查通过，延迟 ${svc.latency}ms`)
  }, 700)
}
function restart(svc: Svc) {
  svc.status = 'checking'
  showToast(`正在重启「${svc.name}」…`)
  window.setTimeout(() => {
    svc.status = 'online'
    svc.latency = Math.round(Math.random() * 300 + 6)
    showToast(`「${svc.name}」已重启完成`)
  }, 1500)
}
function checkAll() {
  showToast(`一键检测：${onlineCount.value}/${services.value.length} 个服务在线`)
}
</script>

<template>
  <div class="page">
    <div class="head">
      <h1>知识库 / 系统设置</h1>
      <p class="hint">管理知识库文件、配置模型与 Embedding 供应商、查看各后端服务运行状态。</p>
    </div>

    <div class="tabs">
      <button class="tab" :class="{ on: tab === 'files' }" @click="tab = 'files'">📁 知识库文件</button>
      <button class="tab" :class="{ on: tab === 'config' }" @click="tab = 'config'">⚙️ 系统配置</button>
      <button class="tab" :class="{ on: tab === 'status' }" @click="tab = 'status'">📡 服务状态</button>
    </div>

    <!-- ==================== Tab1 文件列表 ==================== -->
    <div v-if="tab === 'files'" class="panel">
      <div class="toolbar">
        <input v-model="kbKeyword" class="search" placeholder="搜索文件名…" />
        <button class="btn ghost" @click="refreshFiles">↻ 刷新</button>
        <button class="btn primary" @click="triggerUpload">＋ 上传文件</button>
        <input ref="fileInput" type="file" hidden @change="onUpload" />
      </div>

      <div class="table">
        <div class="tr tr-head">
          <span class="c name">文件名</span>
          <span class="c type">类型</span>
          <span class="c size">大小</span>
          <span class="c chunks">分块</span>
          <span class="c time">上传时间</span>
          <span class="c status">状态</span>
          <span class="c ops">操作</span>
        </div>
        <div v-if="!filteredFiles.length" class="empty">没有匹配的文件，试试上传一个：PDF / Word / PPT / Markdown / 图片 / 音频。</div>
        <div v-for="f in filteredFiles" :key="f.id" class="tr">
          <span class="c name" :title="f.name">📄 {{ f.name }}</span>
          <span class="c type"><em class="tag">{{ f.type }}</em></span>
          <span class="c size">{{ f.size }}</span>
          <span class="c chunks">{{ f.chunks || '—' }}</span>
          <span class="c time">{{ f.updatedAt }}</span>
          <span class="c status">
            <i class="dot" :class="f.status"></i>
            {{ f.status === 'ready' ? '已就绪' : '向量化中…' }}
          </span>
          <span class="c ops">
            <button class="link" @click="previewFile(f.name)">预览</button>
            <button class="link" @click="reindexFile(f.id)">重建</button>
            <button class="link danger" @click="removeFile(f.id)">删除</button>
          </span>
        </div>
      </div>
      <p class="table-note">文件由知识库服务统一解析、分块并向量化，支持 PDF / Word / PPT / Markdown / 图片 / 音频等格式。</p>
    </div>

    <!-- ==================== Tab2 系统配置 ==================== -->
    <div v-else-if="tab === 'config'" class="panel">
      <section class="sec">
        <h2>📝 大纲生成模型</h2>
        <div class="grid">
          <label class="field">
            <span>模型供应商</span>
            <select v-model="outlineCfg.provider" @change="syncModel(outlineCfg, LLM_MODELS)">
              <option v-for="p in LLM_PROVIDERS" :key="p.value" :value="p.value">{{ p.label }}</option>
            </select>
          </label>
          <label class="field">
            <span>模型名称</span>
            <select v-model="outlineCfg.model">
              <option v-for="m in modelOptions(outlineCfg, LLM_MODELS)" :key="m" :value="m">{{ m }}</option>
            </select>
          </label>
          <label class="field">
            <span>API Key</span>
            <span class="secret">
              <input :type="reveal.outline ? 'text' : 'password'" v-model="outlineCfg.apiKey" placeholder="sk-…" />
              <button type="button" class="eye" @click="reveal.outline = !reveal.outline">{{ reveal.outline ? '🙈' : '👁' }}</button>
            </span>
          </label>
          <label class="field">
            <span>Base URL（可选）</span>
            <input v-model="outlineCfg.baseUrl" placeholder="留空使用官方默认地址" />
          </label>
        </div>
        <button class="btn ghost sm" @click="testConn('大纲生成模型')">测试连接</button>
      </section>

      <section class="sec">
        <h2>✍️ 内容生成模型（Writer / Checker）</h2>
        <div class="grid">
          <label class="field">
            <span>模型供应商</span>
            <select v-model="contentCfg.provider" @change="syncModel(contentCfg, LLM_MODELS)">
              <option v-for="p in LLM_PROVIDERS" :key="p.value" :value="p.value">{{ p.label }}</option>
            </select>
          </label>
          <label class="field">
            <span>模型名称</span>
            <select v-model="contentCfg.model">
              <option v-for="m in modelOptions(contentCfg, LLM_MODELS)" :key="m" :value="m">{{ m }}</option>
            </select>
          </label>
          <label class="field">
            <span>API Key</span>
            <span class="secret">
              <input :type="reveal.content ? 'text' : 'password'" v-model="contentCfg.apiKey" placeholder="sk-…" />
              <button type="button" class="eye" @click="reveal.content = !reveal.content">{{ reveal.content ? '🙈' : '👁' }}</button>
            </span>
          </label>
          <label class="field">
            <span>Base URL（可选）</span>
            <input v-model="contentCfg.baseUrl" placeholder="留空使用官方默认地址" />
          </label>
        </div>
        <label class="switch-row">
          <input type="checkbox" v-model="nonStream" />
          <span>内容生成使用非流式（避免逐页 JSON 粘连，后端 CONTENT_STREAMING=false）</span>
        </label>
        <button class="btn ghost sm" @click="testConn('内容生成模型')">测试连接</button>
      </section>

      <section class="sec">
        <h2>🧬 向量 Embedding（知识库）</h2>
        <div class="grid">
          <label class="field">
            <span>Embedding 供应商</span>
            <select v-model="embedCfg.provider" @change="syncModel(embedCfg, EMBED_MODELS)">
              <option v-for="p in EMBED_PROVIDERS" :key="p.value" :value="p.value">{{ p.label }}</option>
            </select>
          </label>
          <label class="field">
            <span>模型名称</span>
            <select v-model="embedCfg.model">
              <option v-for="m in modelOptions(embedCfg, EMBED_MODELS)" :key="m" :value="m">{{ m }}</option>
            </select>
          </label>
          <label class="field">
            <span>API Key</span>
            <span class="secret">
              <input :type="reveal.embed ? 'text' : 'password'" v-model="embedCfg.apiKey" placeholder="sk-…" />
              <button type="button" class="eye" @click="reveal.embed = !reveal.embed">{{ reveal.embed ? '🙈' : '👁' }}</button>
            </span>
          </label>
        </div>
        <button class="btn ghost sm" @click="testConn('Embedding 服务')">测试连接</button>
      </section>

      <div class="save-bar">
        <button class="btn primary" @click="saveAllConfig">💾 保存配置</button>
        <span class="cfg-note">密钥仅保存在当前浏览器本地，不会上传到服务器。</span>
      </div>
    </div>

    <!-- ==================== Tab3 服务状态 ==================== -->
    <div v-else class="panel">
      <div class="status-head">
        <span class="pill" :class="overallOk ? 'ok' : 'warn'">
          <i class="dot" :class="overallOk ? 'online' : 'offline'"></i>
          整体 {{ overallOk ? '运行正常' : `${services.length - onlineCount} 个服务离线` }}
        </span>
        <span class="pill">在线 {{ onlineCount }}/{{ services.length }}</span>
        <button class="btn ghost sm" @click="checkAll">一键检测</button>
      </div>

      <div class="svc-list">
        <div v-for="s in services" :key="s.name" class="svc">
          <i class="dot big" :class="s.status"></i>
          <div class="svc-info">
            <strong>{{ s.name }}</strong>
            <span class="role">{{ s.role }}</span>
            <code>{{ s.addr }}</code>
          </div>
          <span class="state" :class="s.status">
            {{ s.status === 'online' ? `在线 · ${s.latency ?? '—'}ms` : s.status === 'checking' ? '检测中…' : '离线' }}
          </span>
          <div class="svc-ops">
            <button class="btn ghost sm" :disabled="s.status === 'checking'" @click="healthCheck(s)">健康检查</button>
            <button class="btn ghost sm" :disabled="s.status === 'checking'" @click="restart(s)">重启</button>
          </div>
        </div>
      </div>
    </div>

    <!-- toast -->
    <div class="toasts">
      <transition-group name="toast">
        <div v-for="t in toasts" :key="t.id" class="toast" :class="t.type">
          {{ t.type === 'success' ? '✓' : '⚠' }} {{ t.text }}
        </div>
      </transition-group>
    </div>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.head h1 {
  font-size: 22px;
}
.hint {
  color: #8a94a6;
  font-size: 13px;
  margin-top: 6px;
}

/* Tabs */
.tabs {
  display: flex;
  gap: 6px;
  background: #e6e9f3;
  padding: 5px;
  border-radius: 12px;
  width: max-content;
}
.tab {
  border: none;
  background: transparent;
  padding: 9px 22px;
  border-radius: 9px;
  font-size: 14px;
  color: #55607a;
  cursor: pointer;
  transition: 0.15s;
}
.tab.on {
  background: #fff;
  color: #4338ca;
  font-weight: 600;
  box-shadow: 0 4px 12px rgba(30, 40, 80, 0.12);
}

.panel {
  background: #fff;
  border-radius: 14px;
  padding: 22px;
  box-shadow: 0 10px 30px rgba(30, 40, 80, 0.08);
}

/* ---------- 工具栏 / 通用按钮 ---------- */
.toolbar {
  display: flex;
  gap: 10px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.search {
  flex: 1;
  min-width: 200px;
  border: 1px solid #e6e8ef;
  border-radius: 10px;
  padding: 9px 12px;
  font-size: 14px;
  outline: none;
}
.search:focus {
  border-color: #6366f1;
}
.btn {
  border: none;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  padding: 9px 18px;
  border-radius: 10px;
  transition: 0.15s;
}
.btn.primary {
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: #fff;
}
.btn.ghost {
  background: #eef0f7;
  color: #3f4a66;
}
.btn.ghost:hover {
  background: #e2e6f2;
}
.btn.sm {
  padding: 6px 14px;
  font-size: 13px;
}
.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.link {
  border: none;
  background: none;
  color: #6366f1;
  font-size: 13px;
  cursor: pointer;
  padding: 2px 6px;
}
.link:hover {
  text-decoration: underline;
}
.link.danger {
  color: #e11d48;
}

/* ---------- 文件表格 ---------- */
.table {
  border: 1px solid #eef0f6;
  border-radius: 12px;
  overflow: hidden;
}
.tr {
  display: grid;
  grid-template-columns: minmax(240px, 2fr) 70px 90px 70px 130px 110px 140px;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  font-size: 14px;
  border-bottom: 1px solid #f1f3f9;
}
.tr:last-child {
  border-bottom: none;
}
.tr-head {
  background: #f7f8fc;
  color: #7c869c;
  font-size: 12px;
  letter-spacing: 0.5px;
}
.c.name {
  font-weight: 600;
  color: #1f2430;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tag {
  font-style: normal;
  font-size: 12px;
  background: #eef0f7;
  color: #4b5563;
  border-radius: 6px;
  padding: 2px 8px;
  text-transform: uppercase;
}
.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 6px;
  vertical-align: 1px;
}
.dot.online {
  background: #22c55e;
  box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.18);
}
.dot.offline {
  background: #ef4444;
  box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.15);
}
.dot.checking {
  background: #f59e0b;
  animation: pulse 0.8s infinite;
}
.dot.indexing {
  background: #f59e0b;
  animation: pulse 0.8s infinite;
}
@keyframes pulse {
  50% {
    opacity: 0.3;
  }
}
.empty {
  padding: 40px;
  text-align: center;
  color: #a9b2c4;
  font-size: 14px;
}
.table-note {
  color: #a9b2c4;
  font-size: 12px;
  margin-top: 12px;
}

/* ---------- 配置表单 ---------- */
.sec {
  border: 1px solid #eef0f6;
  border-radius: 12px;
  padding: 18px 20px;
  margin-bottom: 16px;
}
.sec h2 {
  font-size: 16px;
  color: #312e81;
  margin: 0 0 14px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14px 20px;
  margin-bottom: 14px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: #55607a;
}
.field select,
.field input {
  border: 1px solid #e0e4ef;
  border-radius: 9px;
  padding: 9px 11px;
  font-size: 14px;
  outline: none;
  background: #fff;
  color: #1f2430;
}
.field select:focus,
.field input:focus {
  border-color: #6366f1;
}
.secret {
  position: relative;
  display: flex;
}
.secret input {
  flex: 1;
}
.secret .eye {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  border: none;
  background: none;
  cursor: pointer;
  font-size: 15px;
}
.switch-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #55607a;
  margin-bottom: 12px;
  cursor: pointer;
}
.save-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 4px;
}
.cfg-note {
  color: #a9b2c4;
  font-size: 12px;
}

/* ---------- 服务状态 ---------- */
.status-head {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.pill {
  display: inline-flex;
  align-items: center;
  font-size: 13px;
  padding: 7px 14px;
  border-radius: 999px;
  background: #f1f3f9;
  color: #3f4a66;
}
.pill.ok {
  background: #e8f9ee;
  color: #15803d;
}
.pill.warn {
  background: #fef3e2;
  color: #b45309;
}
.svc-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.svc {
  display: flex;
  align-items: center;
  gap: 16px;
  border: 1px solid #eef0f6;
  border-radius: 12px;
  padding: 14px 18px;
}
.dot.big {
  width: 12px;
  height: 12px;
  margin: 0;
}
.svc-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.svc-info strong {
  font-size: 15px;
  color: #1f2430;
}
.svc-info .role {
  font-size: 12px;
  color: #8a94a6;
}
.svc-info code {
  font-size: 12px;
  color: #6366f1;
  background: #f0f2fb;
  border-radius: 6px;
  padding: 2px 8px;
  width: max-content;
}
.state {
  font-size: 13px;
  font-weight: 600;
  min-width: 110px;
  text-align: right;
}
.state.online {
  color: #15803d;
}
.state.offline {
  color: #b91c1c;
}
.state.checking {
  color: #b45309;
}
.svc-ops {
  display: flex;
  gap: 8px;
}

/* ---------- toast ---------- */
.toasts {
  position: fixed;
  right: 20px;
  bottom: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 200;
}
.toast {
  background: #1f2937;
  color: #fff;
  font-size: 13px;
  padding: 10px 16px;
  border-radius: 10px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
  max-width: 320px;
}
.toast.warn {
  background: #7c2d12;
}
.toast-enter-active,
.toast-leave-active {
  transition: all 0.25s;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
