// API 封装（对应复现计划第 9.2 节）
// 所有请求走 /api 前缀，由 vite 代理到 http://127.0.0.1:6800
import type { SlideSchema, TemplateInfo } from '../types/AIPPT'

const BASE = '/api'

/** 获取模板列表 */
export async function getTemplates(): Promise<TemplateInfo[]> {
  const res = await fetch(`${BASE}/templates`)
  if (!res.ok) throw new Error('获取模板失败')
  const data = await res.json()
  return data.templates ?? []
}

/**
 * 大纲生成（text/plain 流式）
 * onChunk 每次收到一段文本时回调，最终返回完整大纲
 */
export async function AIPPT_Outline(
  content: string,
  language: string,
  model: string,
  onChunk: (text: string) => void,
): Promise<string> {
  const res = await fetch(`${BASE}/tools/aippt_outline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, language, model, stream: true }),
  })
  if (!res.ok || !res.body) throw new Error('大纲生成请求失败')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let full = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const text = decoder.decode(value, { stream: true })
    full += text
    onChunk(text)
  }
  return full
}

/**
 * 逐页内容生成（SSE，末尾 data: [DONE]）
 * onSlide 每收到一页 JSON 时回调一次
 */
export async function AIPPT_Content(
  markdown: string,
  options: { language?: string; generateFromWebSearch?: boolean; generateFromUploadedFile?: boolean } = {},
  onSlide: (slide: SlideSchema) => void,
): Promise<void> {
  const res = await fetch(`${BASE}/tools/aippt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ content: markdown, language: options.language ?? 'zh', ...options }),
  })
  if (!res.ok || !res.body) throw new Error('内容生成请求失败')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') return
      try {
        onSlide(JSON.parse(payload) as SlideSchema)
      } catch {
        // 忽略无法解析的行
      }
    }
  }
}

/** 依据上传文件生成大纲（multipart/form-data） */
export async function AIPPT_Outline_From_File(file: File, onChunk: (text: string) => void): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${BASE}/tools/aippt_outline_from_file`, { method: 'POST', body: form })
  if (!res.ok || !res.body) throw new Error('文件大纲请求失败')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let full = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const text = decoder.decode(value, { stream: true })
    full += text
    onChunk(text)
  }
  return full
}

/** 按文件 id 生成 PPT（走知识库检索） */
export async function AIPPTByID(fileId: string, onSlide: (slide: SlideSchema) => void): Promise<void> {
  // TODO: 参考 AIPPT_Content 的 SSE 解析实现
  throw new Error(`TODO: 实现 AIPPTByID(fileId=${fileId})`)
}
