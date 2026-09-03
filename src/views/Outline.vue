<script setup lang="ts">
// P02 大纲展示/编辑页（路由 /outline）
// 读取 generation.markdown → 解析为可编辑大纲树（改/增删/排序/子项）→ 序列化写回 store → 跳 /ppt
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useGenerationStore } from '../store/generation'

const router = useRouter()
const gen = useGenerationStore()

interface OutlineNode {
  key: number
  text: string
  children: OutlineNode[]
}

let keySeq = 0
function nextKey(): number {
  return ++keySeq
}
function newNode(text = ''): OutlineNode {
  return { key: nextKey(), text, children: [] }
}

/* ---------------- markdown ⇄ 树 ---------------- */

/** 把 markdown 解析成多级大纲树（标题/列表/缩进混合尽量兼容） */
function parseMarkdown(md: string): OutlineNode[] {
  const roots: OutlineNode[] = []
  const stack: { level: number; node: OutlineNode }[] = []
  for (const rawLine of md.split(/\r?\n/)) {
    const info = analyzeLine(rawLine)
    if (!info) continue
    while (stack.length && stack[stack.length - 1].level >= info.level) stack.pop()
    const node = newNode(info.text)
    const parent = stack.length ? stack[stack.length - 1].node : null
    if (parent) parent.children.push(node)
    else roots.push(node)
    stack.push({ level: info.level, node })
  }
  return roots
}

/** 单行 → {level,text}；空行/纯分隔返回 null */
function analyzeLine(raw: string): { level: number; text: string } | null {
  const trimmed = raw.trim()
  if (!trimmed || /^(-{3,}|\*{3,})$/.test(trimmed)) return null
  const indent = raw.length - raw.trimStart().length
  const step = Math.floor(indent / 2)

  const heading = trimmed.match(/^(#{1,6})\s+(.*)$/)
  if (heading) return { level: Math.min(heading[1].length, 6), text: heading[2].trim() }

  if (/^([-*+]|\d{1,3}[.、)．])\s+/.test(trimmed)) {
    const text = trimmed.replace(/^([-*+]|\d{1,3}[.、)．])\s+/, '').trim()
    return { level: 3 + step, text }
  }
  return { level: 2 + step, text: trimmed }
}

/** 按深度还原成规范 markdown：depth0 → #，depth1 → ##，更深处 → 缩进 - */
function serializeTree(nodes: OutlineNode[]): string {
  const lines: string[] = []
  const walk = (list: OutlineNode[], depth: number) => {
    for (const node of list) {
      const body = node.text.trim() || '未命名'
      if (depth === 0) lines.push(`# ${body}`)
      else if (depth === 1) lines.push(`## ${body}`)
      else lines.push(`${'  '.repeat(depth - 2)}- ${body}`)
      if (node.children.length) walk(node.children, depth + 1)
    }
  }
  walk(nodes, 0)
  return lines.join('\n')
}

/* ---------------- 树的定位与操作 ---------------- */

type Path = number[]

const nodes = ref<OutlineNode[]>([])

function nodeAt(path: Path): OutlineNode {
  let node = nodes.value[path[0]]
  for (let i = 1; i < path.length; i++) node = node.children[path[i]]
  return node
}

function listOf(path: Path): { list: OutlineNode[]; idx: number } {
  if (path.length === 1) return { list: nodes.value, idx: path[0] }
  const parent = nodeAt(path.slice(0, -1))
  return { list: parent.children, idx: path[path.length - 1] }
}

function move(path: Path, dir: -1 | 1) {
  const { list, idx } = listOf(path)
  const to = idx + dir
  if (to < 0 || to >= list.length) return
  const [item] = list.splice(idx, 1)
  list.splice(to, 0, item)
}

function isFirst(path: Path): boolean {
  return listOf(path).idx === 0
}

function isLast(path: Path): boolean {
  const { list, idx } = listOf(path)
  return idx >= list.length - 1
}

function addSibling(path: Path) {
  const { list, idx } = listOf(path)
  list.splice(idx + 1, 0, newNode(path.length === 1 ? '新的章节标题' : '新的要点'))
}

function addChild(path: Path) {
  nodeAt(path).children.push(newNode('新的要点'))
}

function addRoot() {
  nodes.value.push(newNode('新的章节标题'))
}

function removeNode(path: Path) {
  const { list, idx } = listOf(path)
  list.splice(idx, 1)
  if (list.length === 0) {
    // 保留至少一个根节点
    nodes.value.push(newNode('新的章节标题'))
  }
}

/* ---------------- 视图状态 ---------------- */

interface Row {
  node: OutlineNode
  path: Path
  depth: number
  number?: number
}

function flatten(list: OutlineNode[], depth: number, path: Path, rows: Row[]): Row[] {
  list.forEach((node, i) => {
    const p = [...path, i]
    const row: Row = { node, path: p, depth }
    if (depth <= 1) row.number = i + 1
    rows.push(row)
    if (node.children.length) flatten(node.children, depth + 1, p, rows)
  })
  return rows
}

const rows = computed<Row[]>(() => flatten(nodes.value, 0, [], []))

function countTree(list: OutlineNode[], stats: { chapters: number; points: number }) {
  for (const node of list) {
    if (node.children.length) {
      stats.chapters++
      countTree(node.children, stats)
    } else {
      stats.points++
    }
  }
}
const summary = computed(() => {
  const stats = { chapters: 0, points: 0 }
  countTree(nodes.value, stats)
  return stats
})

// 源码视图
const srcMode = ref(false)
const srcText = ref('')
function enterSrcMode() {
  srcText.value = serializeTree(nodes.value)
  srcMode.value = true
}
function exitSrcMode() {
  nodes.value = parseMarkdown(srcText.value)
  if (!nodes.value.length) nodes.value = [newNode('新的章节标题')]
  srcMode.value = false
}

/* ---------------- 加载与保存 ---------------- */

const hasLoaded = ref(false)
const manualMd = ref('')
const loadError = ref('')

function loadMarkdown(md: string) {
  nodes.value = parseMarkdown(md)
  if (!nodes.value.length) {
    loadError.value = '未能解析出有效大纲，请检查内容格式。'
    return
  }
  loadError.value = ''
  hasLoaded.value = true
  gen.setMarkdown(md) // 同步保留原始内容兜底
}

onMounted(() => {
  if (gen.markdown.trim()) loadMarkdown(gen.markdown)
})

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

function saveAndGo(to: string) {
  const md = serializeTree(nodes.value)
  gen.setMarkdown(md)
  router.push(to)
}
</script>

<template>
  <section class="page">
    <!-- 步骤条：P02 当前 -->
    <div class="stepbar">
      <router-link class="step" to="/"><i>1</i> 主题录入</router-link>
      <span class="line"></span>
      <div class="step active"><i>2</i> 大纲编辑</div>
      <span class="line"></span>
      <div class="step"><i>3</i> 选择模板</div>
    </div>

    <!-- 空态：无大纲直达本页 -->
    <div v-if="!hasLoaded" class="card empty">
      <div class="empty-inner">
        <span class="empty-emoji">🗂️</span>
        <h1>这里还没有大纲</h1>
        <p class="hint">先在录入页输入主题生成大纲，或直接把一段 markdown 大纲粘贴到下面。</p>
        <div class="empty-actions">
          <router-link class="btn primary" to="/">← 去录入主题</router-link>
          <button class="btn ghost" @click="loadMarkdown(SAMPLE_MARKDOWN)">载入示例大纲</button>
        </div>
        <textarea v-model="manualMd" rows="8" placeholder="粘贴 markdown 大纲…" class="paste"></textarea>
        <div class="row-actions">
          <button class="btn ghost" @click="loadMarkdown(manualMd)">解析并载入</button>
        </div>
        <p v-if="loadError" class="error">{{ loadError }}</p>
      </div>
    </div>

    <template v-else>
      <!-- 工具条 -->
      <div class="card toolbar">
        <button class="btn ghost back" @click="saveAndGo('/')">← 返回录入</button>
        <div class="tool-title">
          <h1>大纲展示与编辑</h1>
          <span class="count">{{ summary.chapters }} 个章节 · {{ summary.points }} 个要点</span>
        </div>
        <div class="tool-actions">
          <button v-if="!srcMode" class="btn ghost" @click="enterSrcMode">查看源码</button>
          <button v-else class="btn ghost" @click="exitSrcMode">返回树形编辑</button>
          <button class="btn primary" @click="saveAndGo('/ppt')">保存并选择模板 →</button>
        </div>
      </div>

      <!-- 源码视图 -->
      <div v-if="srcMode" class="card">
        <p class="hint">直接修改 markdown 源码，切回树形编辑时会重新解析。</p>
        <textarea v-model="srcText" class="src-area" rows="22"></textarea>
      </div>

      <!-- 树形编辑视图 -->
      <div v-else class="card tree-card">
        <p class="hint">点击文字可直接修改；悬停行尾可排序、增删与添加子项。</p>
        <ol class="tree">
          <li v-for="row in rows" :key="row.node.key" class="row" :class="{ top: row.depth === 0 }">
            <span class="gutter" :style="{ paddingLeft: row.depth * 22 + 'px' }">
              <span v-if="row.number !== undefined" class="badge">{{ row.number }}</span>
              <span v-else class="dot"></span>
            </span>
            <input v-model="row.node.text" class="row-input" type="text" placeholder="未命名" />
            <span class="ops">
              <button title="上移" :disabled="isFirst(row.path)" @click="move(row.path, -1)">↑</button>
              <button title="下移" :disabled="isLast(row.path)" @click="move(row.path, 1)">↓</button>
              <button title="添加子项" @click="addChild(row.path)">＋子</button>
              <button title="在下方新增同级" @click="addSibling(row.path)">同级</button>
              <button title="删除" class="danger" @click="removeNode(row.path)">✕</button>
            </span>
          </li>
        </ol>
        <div class="tree-actions">
          <button class="btn ghost" @click="addRoot">＋ 新增章节</button>
        </div>
      </div>
    </template>
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
  margin: 6px 0 16px;
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
  opacity: 0.5;
  cursor: not-allowed;
}
.error {
  margin-top: 12px;
  color: #dc2626;
  font-size: 13px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  padding: 10px 12px;
}

/* 空态 */
.empty-inner {
  text-align: center;
  max-width: 640px;
  margin: 0 auto;
}
.empty-inner h1 {
  font-size: 22px;
  margin-top: 6px;
}
.empty-emoji {
  font-size: 40px;
}
.empty-actions {
  display: flex;
  justify-content: center;
  gap: 10px;
  margin: 14px 0 20px;
}
.paste {
  width: 100%;
  border: 1px solid #e6e8ef;
  border-radius: 10px;
  padding: 12px;
  font-family: inherit;
  font-size: 13px;
  resize: vertical;
  outline: none;
  text-align: left;
}
.paste:focus {
  border-color: #667eea;
}
.row-actions {
  text-align: right;
  margin-top: 10px;
}

/* 工具条 */
.toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.back {
  font-weight: 500;
}
.tool-title {
  flex: 1;
  min-width: 180px;
}
.tool-title .count {
  color: #8a94a6;
  font-size: 13px;
}
.tool-actions {
  display: flex;
  gap: 10px;
}

/* 源码 */
.src-area {
  width: 100%;
  border: 1px solid #e6e8ef;
  border-radius: 10px;
  padding: 12px;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', monospace;
  font-size: 13px;
  line-height: 1.7;
  resize: vertical;
  outline: none;
}
.src-area:focus {
  border-color: #667eea;
}

/* 树形编辑 */
.tree {
  list-style: none;
  counter-reset: none;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 4px;
  border-radius: 8px;
}
.row:hover {
  background: #f6f7fd;
}
.row.top {
  border-left: 3px solid #764ba2;
}
.gutter {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  min-width: 30px;
}
.badge {
  min-width: 22px;
  height: 22px;
  padding: 0 4px;
  border-radius: 7px;
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  display: inline-grid;
  place-items: center;
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #a5afc4;
}
.row-input {
  flex: 1;
  border: 1px solid transparent;
  background: transparent;
  font-size: 14px;
  color: #1f2430;
  padding: 6px 8px;
  border-radius: 6px;
  outline: none;
  font-family: inherit;
}
.row-input:hover {
  border-color: #e6e8ef;
  background: #fff;
}
.row-input:focus {
  border-color: #667eea;
  background: #fff;
}
.ops {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: 0.12s;
  flex: 0 0 auto;
}
.row:hover .ops,
.row:focus-within .ops {
  opacity: 1;
}
.ops button {
  border: 1px solid #e0e4f0;
  background: #fff;
  color: #55627c;
  font-size: 12px;
  line-height: 1;
  padding: 5px 8px;
  border-radius: 6px;
  cursor: pointer;
}
.ops button:hover:not(:disabled) {
  border-color: #667eea;
  color: #4f46e5;
}
.ops button.danger:hover {
  border-color: #dc2626;
  color: #dc2626;
}
.ops button:disabled {
  opacity: 0.4;
  cursor: default;
}
.tree-actions {
  margin-top: 12px;
  text-align: center;
}
</style>
