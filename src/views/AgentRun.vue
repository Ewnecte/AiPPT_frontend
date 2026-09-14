<script setup lang="ts">
// 多 Agent PPT 生成 · token 看板（B + E）
// ------------------------------------------------------------------
// 展示能力：
//  ① 工具白名单 + 参数 Schema 校验（面板可查看，非法调用在后端被拒）
//  ② 循环熔断：最大步数 / token 预算 / 超时 180s，超限强制终止并返回部分结果
//  ④ 配图内容安全审核 + 版权来源说明
//  演示桥段：预设「熔断演示」让 Planner 反复重写大纲 → 熔断后 token 看板停止增长
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  getAgentInfo,
  listAgentFiles,
  runAgentTask,
  type AgentEvent,
} from '../services'

interface StepItem {
  n: number
  tool: string
  ok: boolean
  summary: string
  tokens: number
  elapsed: number
  error?: { code?: string; message?: string } | null
}

const info = ref<{ tools: string[]; catalog: string; sandbox_dir: string; limits: Record<string, number> } | null>(null)
const infoError = ref('')
const showCatalog = ref(false)

const task = ref('为「AI 大模型行业趋势报告」生成一份 PPT：先写 5 章大纲，为前 3 章各写一段文案，检索 2 张配图，并把产物写入沙箱。')
const mode = ref<'fake' | 'real' | 'auto'>('fake')
const maxSteps = ref(10)
const maxTokens = ref(40000)
const timeoutS = ref(180)
const sandboxPrefix = ref('web/demo')

const running = ref(false)
const events = ref<AgentEvent[]>([])
const steps = ref<StepItem[]>([])
const tokens = ref(0)
const cost = ref(0)
const elapsed = ref(0)
const status = ref<'idle' | 'running' | 'completed' | 'breaker' | 'error'>('idle')
const reason = ref('')
const notice = ref('')
const result = ref<Record<string, unknown> | null>(null)
const sandboxFiles = ref<{ path: string; bytes: number }[]>([])
let controller: AbortController | null = null
let timer: number | null = null

const progress = computed(() => Math.min(100, Math.round((tokens.value / (maxTokens.value || 1)) * 100)))
const stepProgress = computed(() => Math.min(100, Math.round((steps.value.length / (maxSteps.value || 1)) * 100)))
const partial = computed(() => (result.value?.partial as Record<string, unknown>) || null)
const validation = computed(() => (partial.value?.validation as Record<string, unknown>) || null)
const images = computed(() => (partial.value?.images as Record<string, unknown>[]) || [])
const attribution = computed(() => (partial.value?.attribution as string[]) || [])
const files = computed(() => (partial.value?.files as { path: string; bytes: number }[]) || [])
const outline = computed(() => String(partial.value?.outline || ''))
const deadlineText = computed(() => `${elapsed.value.toFixed(1)}s / ${timeoutS.value}s`)

const LOOP_SCRIPT = [
  { thought: '先写第一版大纲', tool: 'outline_generate', args: { topic: 'AI 大模型行业趋势报告', language: '中文', sections: 5 } },
  { thought: '觉得不够好，重写大纲', tool: 'outline_generate', args: { topic: 'AI 大模型行业趋势报告', language: '中文', sections: 5 } },
  { thought: '再重写一版大纲', tool: 'outline_generate', args: { topic: 'AI 大模型行业趋势报告', language: '中文', sections: 5 } },
  { thought: '继续重写大纲', tool: 'outline_generate', args: { topic: 'AI 大模型行业趋势报告', language: '中文', sections: 5 } },
  { thought: '还是不满意，重写大纲', tool: 'outline_generate', args: { topic: 'AI 大模型行业趋势报告', language: '中文', sections: 5 } },
]
const NORMAL_SCRIPT = [
  { thought: '先生成大纲', tool: 'outline_generate', args: { topic: 'AI 大模型行业趋势报告', language: '中文', sections: 5 } },
  { thought: '为第一章写文案', tool: 'copy_generate', args: { section: '行业背景与现状', language: '中文', style: 'professional' } },
  { thought: '为第二章写文案', tool: 'copy_generate', args: { section: '核心技术与能力', language: '中文', style: 'professional' } },
  { thought: '为第三章写文案', tool: 'copy_generate', args: { section: '典型应用场景', language: '中文', style: 'professional' } },
  { thought: '检索配图', tool: 'image_search', args: { query: 'business technology meeting', count: 2 } },
  { thought: '产物落盘', tool: 'write_file', args: { path: 'runs/outline_snapshot.md', content: '# 大纲快照\n（由多 Agent 写入）\n', mode: 'overwrite' } },
  { thought: '可以交付', tool: 'finish', args: {} },
]

function usePreset(kind: 'loop' | 'normal' | 'real') {
  mode.value = kind === 'real' ? 'real' : 'fake'
  if (kind === 'loop') {
    task.value = '为「AI 大模型行业趋势报告」生成 PPT，要求先写大纲，然后反复重写大纲直到完全满意，不得进入文案与配图环节。'
    maxSteps.value = 10
    sandboxPrefix.value = 'web/breaker-demo'
  } else if (kind === 'normal') {
    task.value = '为「AI 大模型行业趋势报告」生成一份 PPT：先写 5 章大纲，为前 3 章各写一段文案，检索 2 张配图，并把产物写入沙箱。'
    maxSteps.value = 10
    sandboxPrefix.value = 'web/demo'
  } else {
    task.value = task.value || '为「AI 大模型行业趋势报告」生成一份 PPT。'
    sandboxPrefix.value = 'web/real'
  }
  notice.value = kind === 'loop' ? '已载入「熔断演示」：Planner 会反复重写大纲，第 3 次重复即熔断。' : ''
}

function pushEvent(ev: AgentEvent) {
  events.value.push(ev)
  if (events.value.length > 300) events.value.shift()
}

function applyEvent(ev: AgentEvent) {
  pushEvent(ev)
  const t = ev.type
  if (t === 'step') {
    steps.value.push({
      n: Number(ev.step || steps.value.length + 1),
      tool: String(ev.tool || ''),
      ok: Boolean(ev.ok),
      summary: String(ev.summary || ''),
      tokens: Number(ev.tokens || 0),
      elapsed: Number(ev.elapsed || 0),
      error: (ev.error as StepItem['error']) || null,
    })
  } else if (t === 'plan') {
    const th = String(ev.thought || '')
    if (th) reason.value = th
  } else if (t === 'loop_detected') {
    notice.value = `检测到循环调用：${ev.tool} 相同参数已重复 ${ev.repeat} 次`
  } else if (t === 'breaker') {
    status.value = 'breaker'
    reason.value = String(ev.reason || '')
    tokens.value = Number(ev.tokens || tokens.value)
    notice.value = '熔断已生效：超限强制终止，token 看板停止增长，但仍返回已完成部分。'
    stopTimer()
  } else if (t === 'result') {
    result.value = (ev.data as Record<string, unknown>) || null
    void refreshFiles()
  } else if (t === 'error') {
    status.value = 'error'
    notice.value = String(ev.message || '任务异常')
    stopTimer()
  } else if (t === 'done') {
    tokens.value = Number(ev.tokens ?? tokens.value)
  }
  if (typeof ev.tokens === 'number') tokens.value = ev.tokens
  if (typeof ev.cost_yuan === 'number') cost.value = ev.cost_yuan
}

function startTimer() {
  stopTimer()
  const t0 = Date.now()
  timer = window.setInterval(() => {
    elapsed.value = (Date.now() - t0) / 1000
  }, 200)
}
function stopTimer() {
  if (timer !== null) {
    window.clearInterval(timer)
    timer = null
  }
}

async function start() {
  if (running.value) return
  if (!task.value.trim()) {
    notice.value = '请先填写任务描述'
    return
  }
  running.value = true
  status.value = 'running'
  reason.value = ''
  notice.value = ''
  events.value = []
  steps.value = []
  tokens.value = 0
  cost.value = 0
  elapsed.value = 0
  result.value = null
  controller = new AbortController()
  startTimer()
  try {
    await runAgentTask(
      {
        task: task.value.trim(),
        mode: mode.value,
        maxSteps: maxSteps.value,
        maxTokens: maxTokens.value,
        timeoutS: timeoutS.value,
        sandboxPrefix: sandboxPrefix.value,
        script: mode.value === 'fake' ? (sandboxPrefix.value.includes('breaker') ? LOOP_SCRIPT : NORMAL_SCRIPT) : undefined,
      },
      applyEvent,
      controller.signal,
    )
    if (status.value === 'running') status.value = 'completed'
  } catch (e) {
    const msg = (e as Error).message
    if (msg.includes('abort')) {
      notice.value = '已手动停止（部分结果仍然保留）'
      status.value = 'idle'
    } else {
      status.value = 'error'
      notice.value = `运行失败：${msg}`
    }
  } finally {
    running.value = false
    stopTimer()
    void refreshFiles()
  }
}

function stop() {
  controller?.abort()
  controller = null
  running.value = false
  stopTimer()
}

async function refreshFiles() {
  try {
    const r = await listAgentFiles(sandboxPrefix.value)
    sandboxFiles.value = r.files
  } catch {
    sandboxFiles.value = []
  }
}

function eventLabel(ev: AgentEvent): string {
  const map: Record<string, string> = {
    start: '▶ 开始',
    plan: '🧠 Planner',
    step: '🔧 工具',
    loop_detected: '🔁 循环检测',
    breaker: '⛔ 熔断',
    artifact: '💾 落盘',
    tool_error: '⚠️ 工具错误',
    result: '📦 结果',
    done: '🏁 结束',
    error: '❌ 异常',
  }
  return map[ev.type] || ev.type
}

function eventText(ev: AgentEvent): string {
  switch (ev.type) {
    case 'start':
      return `limits: 步数 ${(ev.limits as Record<string, number>)?.max_steps} / token ${(ev.limits as Record<string, number>)?.max_tokens} / 超时 ${(ev.limits as Record<string, number>)?.timeout_s}s`
    case 'plan':
      return `tool=${ev.tool} ${ev.thought ? '· ' + ev.thought : ''}`
    case 'step':
      return `#${ev.step} ${ev.tool} ${ev.ok ? 'OK' : 'ERR(' + (ev.error as Record<string, string>)?.code + ')'} ${ev.summary || ''} · tokens=${ev.tokens}`
    case 'loop_detected':
      return `${ev.tool} 相同参数重复 ${ev.repeat} 次`
    case 'breaker':
      return `${ev.reason}（tokens=${ev.tokens}，此后不再增长）`
    case 'artifact':
      return `${ev.path} (${ev.bytes} bytes)`
    case 'result':
      return `status=${(ev.data as Record<string, unknown>)?.status} tokens=${((ev.data as Record<string, unknown>)?.usage as Record<string, number>)?.total_tokens}`
    case 'done':
      return `status=${ev.status} tokens=${ev.tokens} 耗时=${ev.elapsed}s`
    default:
      return JSON.stringify(ev).slice(0, 160)
  }
}

onMounted(async () => {
  try {
    info.value = await getAgentInfo()
  } catch (e) {
    infoError.value = (e as Error).message
  }
  void refreshFiles()
})
onBeforeUnmount(() => {
  stopTimer()
  controller?.abort()
})
</script>

<template>
  <section class="page">
    <div class="head">
      <div>
        <h1>多 Agent PPT 生成 · token 看板</h1>
        <p class="hint">
          工具白名单 + 参数 Schema 强校验 · 步数/token/超时熔断 · 配图内容安全与版权说明 · 熔断后仍返回部分结果
        </p>
      </div>
      <div class="presets">
        <button class="btn ghost sm" type="button" @click="usePreset('loop')">熔断演示</button>
        <button class="btn ghost sm" type="button" @click="usePreset('normal')">正常生成</button>
        <button class="btn ghost sm" type="button" @click="usePreset('real')">真实 LLM</button>
      </div>
    </div>

    <!-- ① 白名单与 Schema -->
    <div class="card">
      <div class="card-head">
        <h2>① 工具白名单（4 个）</h2>
        <button class="text-btn" type="button" @click="showCatalog = !showCatalog">
          {{ showCatalog ? '收起参数 Schema ▲' : '查看参数 Schema ▼' }}
        </button>
      </div>
      <div class="tools">
        <span v-for="t in info?.tools || ['outline_generate', 'copy_generate', 'image_search', 'write_file']" :key="t" class="tool-chip">{{ t }}</span>
        <span v-if="info" class="sandbox">沙箱目录：{{ info.sandbox_dir }}</span>
      </div>
      <pre v-if="showCatalog" class="catalog">{{ info?.catalog || infoError || '加载中…' }}</pre>
      <p class="note">非白名单工具、参数不符合 Schema、写文件路径越界（绝对路径 / .. / 非白名单扩展名）都会被后端直接拒绝。</p>
    </div>

    <!-- 任务与配置 -->
    <div class="card">
      <h2>任务与熔断配置</h2>
      <textarea v-model="task" rows="4" class="task" placeholder="描述本次 PPT 生成任务…"></textarea>
      <div class="config">
        <label class="field">
          <span>运行模式</span>
          <select v-model="mode" class="select">
            <option value="fake">离线演示（脚本化，秒级、零成本）</option>
            <option value="real">真实 LLM</option>
            <option value="auto">自动（有 Key 走真实）</option>
          </select>
        </label>
        <label class="field">
          <span>最大步数</span>
          <input v-model.number="maxSteps" type="number" min="1" max="30" class="input" />
        </label>
        <label class="field">
          <span>token 预算</span>
          <input v-model.number="maxTokens" type="number" min="1000" step="1000" class="input" />
        </label>
        <label class="field">
          <span>超时(s)</span>
          <input v-model.number="timeoutS" type="number" min="5" max="600" class="input" />
        </label>
        <label class="field">
          <span>沙箱子目录</span>
          <input v-model="sandboxPrefix" type="text" class="input wide" />
        </label>
      </div>
      <div class="actions">
        <button class="btn primary" type="button" :disabled="running" @click="start">
          {{ running ? '⏳ 运行中…' : '🚀 开始运行' }}
        </button>
        <button class="btn danger" type="button" :disabled="!running" @click="stop">■ 停止</button>
        <span class="badge" :class="status">{{ status }}</span>
      </div>
      <p v-if="notice" class="notice" :class="{ alert: status === 'breaker' }">{{ notice }}</p>
    </div>

    <!-- ② token 看板 -->
    <div class="card">
      <h2>② token 看板 / 熔断状态</h2>
      <div class="metrics">
        <div class="metric">
          <span class="k">token</span>
          <strong>{{ tokens }} / {{ maxTokens }}</strong>
        </div>
        <div class="metric">
          <span class="k">步数</span>
          <strong>{{ steps.length }} / {{ maxSteps }}</strong>
        </div>
        <div class="metric">
          <span class="k">耗时</span>
          <strong>{{ deadlineText }}</strong>
        </div>
        <div class="metric">
          <span class="k">成本</span>
          <strong>¥{{ cost.toFixed(5) }}</strong>
        </div>
        <div class="metric">
          <span class="k">状态</span>
          <strong :class="{ danger: status === 'breaker', ok: status === 'completed' }">{{ status }}</strong>
        </div>
      </div>
      <div class="bar"><div class="bar-inner" :style="{ width: progress + '%' }"></div></div>
      <div class="bar thin"><div class="bar-inner alt" :style="{ width: stepProgress + '%' }"></div></div>
      <p class="note">token 进度条达到 100%、步数用尽或超时即触发熔断；熔断后计数冻结（看板停止增长）。</p>
    </div>

    <div class="grid2">
      <!-- 事件流 -->
      <div class="card">
        <h2>执行轨迹</h2>
        <ol class="steps">
          <li v-for="s in steps" :key="s.n" :class="{ bad: !s.ok }">
            <span class="no">#{{ s.n }}</span>
            <span class="tool">{{ s.tool }}</span>
            <span class="sum">{{ s.summary || (s.error?.message || '') }}</span>
            <span class="meta">tokens {{ s.tokens }} · {{ s.elapsed }}s</span>
          </li>
          <li v-if="!steps.length" class="empty">尚未执行任何工具</li>
        </ol>
        <div class="log">
          <div v-for="(ev, i) in events.slice(-60)" :key="i" class="log-line">
            <b>{{ eventLabel(ev) }}</b> {{ eventText(ev) }}
          </div>
        </div>
      </div>

      <!-- 部分结果 -->
      <div class="card">
        <h2>部分结果 / 成稿校验</h2>
        <template v-if="partial">
          <p class="note">
            熔断或完成后都会交付已完成部分：
            <b>{{ partial.partial_returned ? '本次为熔断后的部分结果' : '完整结果' }}</b>
          </p>
          <div class="kv">
            <span>大纲字数</span><b>{{ outline.length }}</b>
            <span>文案段数</span><b>{{ Object.keys((partial.copies as object) || {}).length }}</b>
            <span>配图</span><b>{{ images.length }} 张</b>
            <span>沙箱文件</span><b>{{ files.length }} 个</b>
            <span v-if="validation">结构校验</span>
            <b v-if="validation">
              可打开={{ validation.openable }} · 结构合规={{ validation.structure_ok }} · 页数={{ validation.page_count }}
            </b>
          </div>
          <ul class="files">
            <li v-for="f in files" :key="f.path">{{ f.path }} <span class="meta">{{ f.bytes }} bytes</span></li>
          </ul>
          <div v-if="images.length" class="images">
            <figure v-for="(img, i) in images" :key="i">
              <img :src="String(img.url)" :alt="String(img.title || '')" loading="lazy" />
              <figcaption>{{ img.title || img.query }}<br /><span class="meta">{{ (img.attribution as Record<string, string>)?.license }}</span></figcaption>
            </figure>
          </div>
          <div v-if="attribution.length" class="attr">
            <h3>④ 图片来源说明（可直接放入参考资料页）</h3>
            <p v-for="(a, i) in attribution" :key="i">{{ a }}</p>
          </div>
          <details v-if="outline">
            <summary>查看已生成大纲</summary>
            <pre class="outline">{{ outline }}</pre>
          </details>
        </template>
        <p v-else class="note">运行结束后这里会显示大纲、文案、配图（含版权来源）、结构校验与沙箱落盘文件。</p>
      </div>
    </div>

    <!-- 沙箱产物 -->
    <div class="card">
      <div class="card-head">
        <h2>沙箱产物（后端 agent_sandbox）</h2>
        <button class="text-btn" type="button" @click="refreshFiles">刷新</button>
      </div>
      <ul class="files">
        <li v-for="f in sandboxFiles" :key="f.path">{{ f.path }} <span class="meta">{{ f.bytes }} bytes</span></li>
        <li v-if="!sandboxFiles.length" class="empty">（暂无文件）</li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
h1 {
  font-size: 21px;
}
h2 {
  font-size: 15px;
  color: #1f2430;
}
.hint,
.note {
  color: #8a94a6;
  font-size: 12px;
  line-height: 1.7;
  margin-top: 6px;
}
.presets {
  display: flex;
  gap: 8px;
}
.card {
  background: #fff;
  border-radius: 14px;
  padding: 16px 18px;
  box-shadow: 0 10px 30px rgba(30, 40, 80, 0.06);
}
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.tools {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 10px;
}
.tool-chip {
  background: #eef0ff;
  color: #4f46e5;
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 999px;
  font-family: Consolas, Menlo, monospace;
}
.sandbox {
  color: #9aa2b5;
  font-size: 11px;
}
.catalog {
  margin-top: 10px;
  background: #f7f8fc;
  border-radius: 10px;
  padding: 12px;
  max-height: 260px;
  overflow: auto;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  color: #3f4657;
}
.task {
  width: 100%;
  margin-top: 10px;
  border: 1px solid #e6e8ef;
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 13px;
  font-family: inherit;
  resize: vertical;
  outline: none;
}
.task:focus {
  border-color: #667eea;
}
.config {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  margin-top: 12px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: #55627c;
}
.input,
.select {
  border: 1px solid #e6e8ef;
  border-radius: 8px;
  padding: 6px 8px;
  font-size: 13px;
  background: #fff;
  outline: none;
  min-width: 120px;
}
.input.wide {
  min-width: 200px;
}
.actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
}
.btn {
  border: none;
  cursor: pointer;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  padding: 10px 18px;
}
.btn.sm {
  padding: 6px 12px;
  font-size: 12px;
  border-radius: 8px;
}
.btn.primary {
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: #fff;
}
.btn.ghost {
  background: #fff;
  color: #4f46e5;
  border: 1px solid #c7d0f4;
}
.btn.danger {
  background: #fef2f2;
  color: #dc2626;
  border: 1px solid #fecaca;
}
.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.text-btn {
  border: none;
  background: none;
  color: #6366f1;
  font-size: 12px;
  cursor: pointer;
}
.badge {
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 999px;
  background: #f1f3fa;
  color: #55627c;
}
.badge.running {
  background: #eef0ff;
  color: #4f46e5;
}
.badge.completed {
  background: #e8f8f0;
  color: #0f9d58;
}
.badge.breaker,
.badge.error {
  background: #fef2f2;
  color: #dc2626;
}
.notice {
  margin-top: 12px;
  font-size: 13px;
  color: #55627c;
  background: #f7f8fc;
  border-radius: 8px;
  padding: 10px 12px;
}
.notice.alert {
  background: #fff7ed;
  color: #b45309;
}
.metrics {
  display: flex;
  gap: 22px;
  flex-wrap: wrap;
  margin-top: 10px;
}
.metric {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.metric .k {
  font-size: 11px;
  color: #9aa2b5;
}
.metric strong {
  font-size: 16px;
  color: #1f2430;
}
.metric strong.ok {
  color: #0f9d58;
}
.metric strong.danger {
  color: #dc2626;
}
.bar {
  margin-top: 12px;
  height: 10px;
  border-radius: 999px;
  background: #eef0f6;
  overflow: hidden;
}
.bar.thin {
  height: 6px;
  margin-top: 6px;
}
.bar-inner {
  height: 100%;
  background: linear-gradient(90deg, #667eea, #764ba2);
  transition: width 0.2s;
}
.bar-inner.alt {
  background: linear-gradient(90deg, #22c55e, #14b8a6);
}
.grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
@media (max-width: 1000px) {
  .grid2 {
    grid-template-columns: 1fr;
  }
}
.steps {
  list-style: none;
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.steps li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  background: #f7f8fc;
  border-radius: 8px;
  padding: 6px 10px;
}
.steps li.bad {
  background: #fef2f2;
}
.steps .no {
  color: #4f46e5;
  font-weight: 700;
}
.steps .tool {
  font-family: Consolas, Menlo, monospace;
  color: #334155;
}
.steps .sum {
  flex: 1;
  color: #55627c;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.steps .meta {
  color: #9aa2b5;
  font-size: 11px;
}
.log {
  margin-top: 12px;
  background: #0f1220;
  border-radius: 10px;
  padding: 10px 12px;
  max-height: 220px;
  overflow: auto;
}
.log-line {
  font-family: Consolas, Menlo, monospace;
  font-size: 11px;
  color: #b6c0ff;
  line-height: 1.8;
}
.log-line b {
  color: #fff;
}
.kv {
  display: grid;
  grid-template-columns: auto 1fr auto 1fr;
  gap: 6px 10px;
  margin-top: 10px;
  font-size: 12px;
  color: #55627c;
}
.kv b {
  color: #1f2430;
}
.files {
  list-style: none;
  margin-top: 10px;
  font-size: 12px;
  color: #334155;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.files .meta {
  color: #9aa2b5;
}
.images {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 12px;
}
.images figure {
  width: 150px;
}
.images img {
  width: 100%;
  border-radius: 8px;
  background: #eef0f6;
}
.images figcaption {
  font-size: 11px;
  color: #55627c;
  margin-top: 4px;
  line-height: 1.5;
}
.attr {
  margin-top: 12px;
  background: #f7f8fc;
  border-radius: 10px;
  padding: 10px 12px;
}
.attr h3 {
  font-size: 12px;
  color: #4f46e5;
  margin-bottom: 6px;
}
.attr p {
  font-size: 11px;
  color: #55627c;
  line-height: 1.7;
}
details {
  margin-top: 12px;
}
summary {
  font-size: 12px;
  color: #6366f1;
  cursor: pointer;
}
.outline {
  margin-top: 8px;
  max-height: 260px;
  overflow: auto;
  white-space: pre-wrap;
  font-size: 12px;
  line-height: 1.7;
  color: #3f4657;
}
.empty {
  color: #b6bcc9;
  font-size: 12px;
}
</style>
