// AIPPT 排版引擎
// ------------------------------------------------------------------
// SlideSchema（生成契约） -> 1920×1080 坐标系里的可定位元素(EditorSlide)
// 元素文本通过 `ref` 字段与 SlideSchema 双向同步，可随时还原为 SlideSchema。
import type {
  ChartItem,
  ContentItem,
  SlideData,
  SlideSchema,
  SlideType,
} from '../types/AIPPT'
import type {
  ChartEl,
  EditorSlide,
  RectEl,
  SlideBackground,
  SlideElement,
  TextEl,
} from '../types/editor'
import { SLIDE_W, SLIDE_H } from '../types/editor'

export const SLIDE_TYPE_LABELS: Record<SlideType, string> = {
  cover: '封面',
  contents: '目录',
  transition: '过渡',
  content: '内容',
  reference: '引用',
  end: '结束',
}

export const SLIDE_TYPES: SlideType[] = [
  'cover',
  'contents',
  'transition',
  'content',
  'reference',
  'end',
]

/** 一套可用的版式主色（与品牌紫蓝一致的家族） */
export const ACCENTS = [
  '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
  '#0ea5e9', '#14b8a6', '#10b981', '#f59e0b', '#ef4444',
]

export function accentAt(i: number): string {
  return ACCENTS[((i % ACCENTS.length) + ACCENTS.length) % ACCENTS.length]
}

let _k = 0
export function uid(): string {
  const c = typeof crypto !== 'undefined' && crypto.randomUUID
  return c ? crypto.randomUUID().replace(/-/g, '').slice(0, 10) : `e${Date.now().toString(36)}${(_k++).toString(36)}`
}

export function cloneSchema(s: SlideSchema): SlideSchema {
  return JSON.parse(JSON.stringify(s)) as SlideSchema
}

export function cloneSlide(es: EditorSlide): EditorSlide {
  return JSON.parse(JSON.stringify(es)) as EditorSlide
}

// ------------------------------------------------------------------
// 页面背景预设
// ------------------------------------------------------------------
const DARK_COVER =
  'radial-gradient(1100px 520px at 82% -6%, rgba(255,255,255,.22), rgba(255,255,255,0) 60%), radial-gradient(900px 620px at -6% 108%, rgba(45,212,191,.30), rgba(0,0,0,0) 55%), linear-gradient(135deg, #4338ca 0%, #6d28d9 55%, #9d174d 135%)'
const DARK_TRANS =
  'radial-gradient(1000px 500px at 88% -10%, rgba(255,255,255,.20), rgba(255,255,255,0) 55%), linear-gradient(150deg, #312e81 0%, #4c1d95 60%, #6b21a8 120%)'
const DARK_END =
  'radial-gradient(900px 460px at 50% -4%, rgba(255,255,255,.18), rgba(255,255,255,0) 55%), linear-gradient(135deg, #312e81 0%, #5b21b6 100%)'
const LIGHT =
  'radial-gradient(760px 420px at 96% 0%, rgba(124,58,237,.10), rgba(124,58,237,0) 60%), radial-gradient(680px 420px at 0% 100%, rgba(59,130,246,.12), rgba(59,130,246,0) 55%), linear-gradient(165deg, #ffffff, #f6f5ff)'
const LIGHT2 =
  'radial-gradient(700px 380px at 100% 0%, rgba(236,72,153,.08), rgba(236,72,153,0) 60%), linear-gradient(170deg, #ffffff, #f4f7ff)'

export function backgroundFor(type: SlideType): SlideBackground {
  switch (type) {
    case 'cover':
      return { css: DARK_COVER, dark: true }
    case 'contents':
      return { css: LIGHT, dark: false }
    case 'transition':
      return { css: DARK_TRANS, dark: true }
    case 'content':
      return { css: LIGHT, dark: false }
    case 'reference':
      return { css: LIGHT2, dark: false }
    default:
      return { css: DARK_END, dark: true }
  }
}

/** 编辑器里可切换的背景预设 */
export const BACKGROUND_PRESETS: { label: string; bg: SlideBackground }[] = [
  { label: '深蓝紫', bg: { css: DARK_COVER, dark: true } },
  { label: '深紫章节', bg: { css: DARK_TRANS, dark: true } },
  { label: '深紫结束', bg: { css: DARK_END, dark: true } },
  { label: '亮紫罗兰', bg: { css: LIGHT, dark: false } },
  { label: '亮白粉紫', bg: { css: LIGHT2, dark: false } },
]

// ------------------------------------------------------------------
// 元素工厂
// ------------------------------------------------------------------
function mkText(p: Partial<TextEl> & { id?: string }): TextEl {
  return {
    id: p.id || uid(),
    type: 'text',
    left: 0,
    top: 0,
    width: 400,
    height: 120,
    text: '',
    fontSize: 28,
    color: '#1f2340',
    align: 'left',
    valign: 'top',
    lineHeight: 1.4,
    ...p,
  } as TextEl
}

function mkRect(p: Partial<RectEl> & { id?: string }): RectEl {
  return {
    id: p.id || uid(),
    type: 'rect',
    left: 0,
    top: 0,
    width: 100,
    height: 40,
    bg: '#6366f1',
    radius: 8,
    ...p,
  } as RectEl
}

function mkChart(p: Partial<ChartEl> & { id?: string }): ChartEl {
  return {
    id: p.id || uid(),
    type: 'chart',
    left: 0,
    top: 0,
    width: 800,
    height: 400,
    chart: { kind: 'chart', title: '', text: '', chartType: 'bar', labels: [], series: [] },
    ...p,
  } as ChartEl
}

// ------------------------------------------------------------------
// ref 读写：把元素文本同步到 SlideSchema
// ------------------------------------------------------------------
export function getSchemaText(schema: SlideSchema, ref?: string): string {
  if (!ref || !schema.data) return ''
  const d = schema.data
  const getItem = (idx: number): ContentItem | string | undefined => {
    const items = d.items as (ContentItem | string)[] | undefined
    return items ? items[idx] : undefined
  }
  if (ref === 'title') return typeof d.title === 'string' ? d.title : ''
  if (ref === 'text') return typeof d.text === 'string' ? d.text : ''
  const m = /^items\.(\d+)(\.(title|text))?$/.exec(ref)
  if (m) {
    const it = getItem(Number(m[1]))
    if (it === undefined) return ''
    if (typeof it === 'string') return m[3] === 'title' ? it : ''
    return m[3] === 'title' ? (it.title ?? '') : (it.text ?? '')
  }
  const r = /^references\.(\d+)$/.exec(ref)
  if (r) {
    const refs = d.references as string[] | undefined
    return refs ? (refs[Number(r[1])] ?? '') : ''
  }
  return ''
}

export function setSchemaText(schema: SlideSchema, ref: string, value: string): void {
  if (!schema.data) schema.data = {}
  const d = schema.data
  if (ref === 'title') {
    d.title = value
    return
  }
  if (ref === 'text') {
    d.text = value
    return
  }
  const m = /^items\.(\d+)(\.(title|text))?$/.exec(ref)
  if (m) {
    if (!d.items) d.items = []
    const idx = Number(m[1])
    const it = d.items[idx] as ContentItem | string | undefined
    if (m[3]) {
      const obj: ContentItem = typeof it === 'string' || !it ? { title: typeof it === 'string' ? it : '', text: '' } : it
      if (m[3] === 'title') obj.title = value
      else obj.text = value
      d.items[idx] = obj
    } else {
      d.items[idx] = value
    }
    return
  }
  const r = /^references\.(\d+)$/.exec(ref)
  if (r) {
    if (!d.references) d.references = []
    d.references[Number(r[1])] = value
  }
}

/** 供元素文字改动时同步回 schema（decorative/rect/chart 忽略） */
export function syncElementToSchema(schema: SlideSchema, el: SlideElement): void {
  if (el.type === 'text' && el.ref && !el.decorative) {
    setSchemaText(schema, el.ref, el.text)
  }
}

// ------------------------------------------------------------------
// 空 schema / 空白页
// ------------------------------------------------------------------
export function blankSchemaFor(type: SlideType): SlideSchema {
  switch (type) {
    case 'cover':
      return { type: 'cover', data: { title: '主标题', text: '副标题（双击右侧面板修改文字）' } }
    case 'contents':
      return { type: 'contents', data: { items: ['目录项 1', '目录项 2', '目录项 3'] } }
    case 'transition':
      return { type: 'transition', data: { title: '章节标题', text: '' } }
    case 'content':
      return {
        type: 'content',
        data: {
          title: '内容页标题',
          items: [
            { title: '要点一', text: '在这里输入正文…' },
            { title: '要点二', text: '在这里输入正文…' },
          ],
        },
      }
    case 'reference':
      return { type: 'reference', data: { title: '参考资料', references: ['1. 参考文献一', '2. 参考文献二'] } }
    default:
      return { type: 'end', data: {} }
  }
}

export function createBlankSlide(type: SlideType, opts?: { accent?: string }): EditorSlide {
  const schema = blankSchemaFor(type)
  return schemaToSlide(schema, opts)
}

// ------------------------------------------------------------------
// 排版引擎：SlideSchema -> 元素
// ------------------------------------------------------------------
export interface LayoutCtx {
  accent?: string
  /** 该过渡页在全篇中是第几个过渡页(从 0 计)，用于显示章节号 */
  transitionIndex?: number
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function coverLayout(schema: SlideSchema, accent: string): SlideElement[] {
  const d = (schema.data || {}) as SlideData
  const els: SlideElement[] = []
  // 顶部品牌角标（装饰）
  els.push(
    mkText({
      decorative: true,
      text: 'AiPPT · 智能演示',
      left: 1500, top: 52, width: 380, height: 40,
      fontSize: 22, color: 'rgba(255,255,255,.72)', align: 'right',
    }),
  )
  els.push(
    mkText({
      ref: 'title',
      text: d.title || '演示文稿标题',
      left: 160, top: 400, width: 1600, height: 210,
      fontSize: 96, fontWeight: 800, color: '#ffffff', align: 'center', valign: 'middle',
      lineHeight: 1.15,
    }),
  )
  // 标题下装饰短线
  els.push(mkRect({ decorative: true, left: 860, top: 636, width: 200, height: 10, bg: accent, radius: 5 }))
  if (d.text) {
    els.push(
      mkText({
        ref: 'text',
        text: d.text,
        left: 310, top: 690, width: 1300, height: 120,
        fontSize: 34, color: 'rgba(255,255,255,.85)', align: 'center', valign: 'top',
        lineHeight: 1.5,
      }),
    )
  }
  return els
}

function transitionLayout(schema: SlideSchema, accent: string, ctx: LayoutCtx): SlideElement[] {
  const d = (schema.data || {}) as SlideData
  const no = (ctx.transitionIndex ?? 0) + 1
  const els: SlideElement[] = []
  // 巨型水印章节号（装饰，在底层）
  els.push(
    mkText({
      decorative: true,
      text: pad2(no),
      left: 1080, top: 120, width: 720, height: 380,
      fontSize: 340, fontWeight: 800, color: 'rgba(255,255,255,.12)', align: 'right',
      lineHeight: 1,
    }),
  )
  els.push(
    mkText({
      decorative: true,
      text: `PART ${pad2(no)}`,
      left: 150, top: 240, width: 500, height: 44,
      fontSize: 26, fontWeight: 700, color: accent, letterSpacing: 4, align: 'left',
    }),
  )
  els.push(mkRect({ decorative: true, left: 152, top: 306, width: 76, height: 12, bg: accent, radius: 6 }))
  els.push(
    mkText({
      ref: 'title',
      text: d.title || '章节标题',
      left: 150, top: 360, width: 1380, height: 150,
      fontSize: 88, fontWeight: 800, color: '#ffffff', align: 'left', valign: 'middle',
      lineHeight: 1.2,
    }),
  )
  if (d.text) {
    els.push(
      mkText({
        ref: 'text',
        text: d.text,
        left: 154, top: 560, width: 1260, height: 110,
        fontSize: 30, color: 'rgba(255,255,255,.78)', align: 'left',
        lineHeight: 1.6,
      }),
    )
  }
  return els
}

function contentsLayout(schema: SlideSchema, accent: string): SlideElement[] {
  const d = (schema.data || {}) as SlideData
  const items = (d.items as (ContentItem | string)[] | undefined) ?? []
  const els: SlideElement[] = []
  els.push(
    mkText({
      decorative: true,
      text: '目录',
      left: 150, top: 66, width: 320, height: 110,
      fontSize: 62, fontWeight: 800, color: '#1d2140', align: 'left', valign: 'middle',
    }),
  )
  els.push(
    mkText({
      decorative: true,
      text: 'CONTENTS',
      left: 150, top: 178, width: 360, height: 34,
      fontSize: 22, fontWeight: 700, color: accent, align: 'left', letterSpacing: 6,
    }),
  )
  els.push(mkRect({ decorative: true, left: 153, top: 226, width: 70, height: 10, bg: accent, radius: 5 }))

  if (!items.length) {
    els.push(
      mkText({
        decorative: true,
        text: '（空目录：在右侧面板增删目录项）',
        left: 300, top: 560, width: 1000, height: 80,
        fontSize: 30, color: '#9aa0b4', align: 'center',
      }),
    )
    return els
  }

  const n = items.length
  const areaL = 150
  const areaR = SLIDE_W - 150
  const y0 = 300
  const y1 = SLIDE_H - 70
  const cols = n <= 3 ? 1 : n <= 8 ? 2 : 3
  const gapX = 44
  const gapY = 34
  const colW = (areaR - areaL - gapX * (cols - 1)) / cols
  const rows = Math.ceil(n / cols)
  const rowH = (y1 - y0 - gapY * (rows - 1)) / rows

  items.forEach((raw, i) => {
    const s = typeof raw === 'string' ? raw : raw?.title ?? raw?.text ?? ''
    const c = i % cols
    const r = Math.floor(i / cols)
    const x = areaL + c * (colW + gapX)
    const y = y0 + r * (rowH + gapY)
    // 卡片底
    els.push(
      mkRect({
        decorative: true,
        left: x, top: y, width: colW, height: rowH,
        bg: 'rgba(255,255,255,.78)', radius: 20, borderColor: 'rgba(99,102,241,.16)',
      }),
    )
    // 序号徽标
    els.push(
      mkText({
        decorative: true,
        text: String(i + 1),
        left: x + 30, top: y + (rowH - 66) / 2, width: 66, height: 66,
        fontSize: 40, fontWeight: 800, color: accent, align: 'center', valign: 'middle',
      }),
    )
    const fontSize = rowH > 230 ? 27 : rowH > 170 ? 24 : 21
    els.push(
      mkText({
        ref: `items.${i}`,
        text: s,
        left: x + 118, top: y + 14, width: colW - 150, height: rowH - 28,
        fontSize, color: '#2a3152', align: 'left', valign: 'middle', lineHeight: 1.5,
      }),
    )
  })
  return els
}

function contentLayout(schema: SlideSchema, accent: string): SlideElement[] {
  const d = (schema.data || {}) as SlideData
  const rawItems = (d.items as (ContentItem | string)[] | undefined) ?? []
  const blocks: { title: string; text: string; chart?: ChartItem }[] = rawItems.map((raw) => {
    if (typeof raw === 'string') return { title: raw, text: '' }
    if (raw?.kind === 'chart') {
      const c = raw as unknown as ChartItem
      return { title: c.title ?? '', text: c.text ?? '', chart: c }
    }
    return { title: raw?.title ?? '', text: raw?.text ?? '' }
  })

  const els: SlideElement[] = []
  els.push(
    mkText({
      ref: 'title',
      text: d.title || '内容页标题',
      left: 150, top: 58, width: 1600, height: 92,
      fontSize: 54, fontWeight: 800, color: '#1d2140', align: 'left', valign: 'middle',
      lineHeight: 1.2,
    }),
  )
  els.push(mkRect({ decorative: true, left: 153, top: 162, width: 96, height: 12, bg: accent, radius: 6 }))

  const areaL = 150
  const areaW = SLIDE_W - 300
  const y0 = 230
  const y1 = SLIDE_H - 60
  const gap = 28

  if (!blocks.length) {
    els.push(
      mkText({
        decorative: true,
        text: '（空内容页：在右侧面板增删内容项）',
        left: areaL, top: 520, width: areaW, height: 80,
        fontSize: 30, color: '#9aa0b4', align: 'center',
      }),
    )
    return els
  }

  const onlyChart = blocks.length === 1 && blocks[0].chart
  if (onlyChart) {
    const c = blocks[0].chart as ChartItem
    const bx = areaL
    const by = y0 + 40
    const bw = areaW
    const bh = 640
    els.push(mkRect({ decorative: true, left: bx, top: by, width: bw, height: bh, bg: 'rgba(255,255,255,.9)', radius: 22, borderColor: 'rgba(99,102,241,.16)' }))
    if (c.title) {
      els.push(mkText({ decorative: true, text: c.title, left: bx + 48, top: by + 32, width: bw - 96, height: 56, fontSize: 34, fontWeight: 700, color: '#1d2140' }))
    }
    els.push(mkChart({ decorative: true, left: bx + 60, top: by + (c.title ? 120 : 60), width: bw - 120, height: bh - (c.title ? 170 : 100), chart: c }))
    return els
  }

  const count = blocks.length
  const rowH = Math.min(236, (y1 - y0 - gap * (count - 1)) / count)

  blocks.forEach((b, i) => {
    const y = y0 + i * (rowH + gap)
    if (b.chart) {
      els.push(mkRect({ decorative: true, left: areaL, top: y, width: areaW, height: rowH, bg: 'rgba(255,255,255,.9)', radius: 18, borderColor: 'rgba(99,102,241,.16)' }))
      els.push(mkChart({ decorative: true, left: areaL + 40, top: y + 24, width: areaW - 80, height: rowH - 48, chart: b.chart }))
      return
    }
    // 序号
    els.push(
      mkText({
        decorative: true,
        text: pad2(i + 1),
        left: areaL + 36, top: y + (rowH - 54) / 2, width: 54, height: 54,
        fontSize: 30, fontWeight: 800, color: accent, align: 'center', valign: 'middle',
      }),
    )
    els.push(
      mkRect({
        decorative: true,
        left: areaL, top: y, width: areaW, height: rowH,
        bg: 'rgba(255,255,255,.82)', radius: 18, borderColor: 'rgba(99,102,241,.14)',
      }),
    )
    // 标题（要点）/ 正文
    const hasBody = !!b.text
    if (b.title) {
      const titleFont = rowH > 170 ? 32 : 27
      els.push(
        mkText({
          ref: `items.${i}.title`,
          text: b.title,
          left: areaL + 118,
          top: hasBody ? y + 16 : y + (rowH - 52) / 2,
          width: areaW - 160, height: hasBody ? 50 : 52,
          fontSize: titleFont, fontWeight: 700, color: '#232850', align: 'left',
          valign: 'middle', lineHeight: 1.3,
        }),
      )
    }
    if (hasBody) {
      const top = b.title ? y + rowH - 62 : y + (rowH - 46) / 2
      els.push(
        mkText({
          ref: `items.${i}.text`,
          text: b.text,
          left: areaL + 122, top, width: areaW - 170, height: 46,
          fontSize: rowH > 190 ? 24 : 21, color: '#5c6480', align: 'left',
          valign: 'top', lineHeight: 1.5,
        }),
      )
    }
  })
  return els
}

function referenceLayout(schema: SlideSchema, accent: string): SlideElement[] {
  const d = (schema.data || {}) as SlideData
  const refs = (d.references as string[] | undefined) ?? []
  const els: SlideElement[] = []
  els.push(
    mkText({
      ref: 'title',
      text: d.title || '参考资料',
      left: 150, top: 60, width: 1400, height: 90,
      fontSize: 56, fontWeight: 800, color: '#1d2140', align: 'left', valign: 'middle',
    }),
  )
  els.push(mkRect({ decorative: true, left: 153, top: 164, width: 96, height: 12, bg: accent, radius: 6 }))
  if (!refs.length) {
    els.push(
      mkText({
        decorative: true, text: '（空引用）', left: 300, top: 520, width: 1000, height: 80,
        fontSize: 30, color: '#9aa0b4', align: 'center',
      }),
    )
    return els
  }
  refs.forEach((s, i) => {
    const y = 320 + i * 148
    if (y > 980) return
    els.push(
      mkText({
        decorative: true,
        text: pad2(i + 1),
        left: 200, top: y - 4, width: 56, height: 56,
        fontSize: 26, fontWeight: 800, color: accent, align: 'center', valign: 'middle',
      }),
    )
    els.push(
      mkText({
        ref: `references.${i}`,
        text: s,
        left: 300, top: y - 6, width: 1420, height: 90,
        fontSize: 26, color: '#39405f', align: 'left', valign: 'top', lineHeight: 1.5,
      }),
    )
  })
  return els
}

function endLayout(schema: SlideSchema, accent: string): SlideElement[] {
  const els: SlideElement[] = []
  els.push(
    mkText({
      decorative: true,
      text: '感谢聆听',
      left: 260, top: 420, width: 1400, height: 150,
      fontSize: 96, fontWeight: 800, color: '#ffffff', align: 'center', valign: 'middle',
    }),
  )
  els.push(mkRect({ decorative: true, left: 860, top: 590, width: 200, height: 10, bg: accent, radius: 5 }))
  els.push(
    mkText({
      decorative: true,
      text: 'THANKS FOR WATCHING',
      left: 360, top: 640, width: 1200, height: 50,
      fontSize: 26, fontWeight: 700, color: 'rgba(255,255,255,.6)', align: 'center', letterSpacing: 8,
    }),
  )
  return els
}

export function schemaToSlide(schema: SlideSchema, opts?: LayoutCtx): EditorSlide {
  const type = schema.type
  const accent = opts?.accent ?? accentAt(0)
  const els: SlideElement[] = (() => {
    switch (type) {
      case 'cover':
        return coverLayout(schema, accent)
      case 'contents':
        return contentsLayout(schema, accent)
      case 'transition':
        return transitionLayout(schema, accent, opts ?? {})
      case 'content':
        return contentLayout(schema, accent)
      case 'reference':
        return referenceLayout(schema, accent)
      default:
        return endLayout(schema, accent)
    }
  })()
  return {
    id: uid(),
    type,
    background: backgroundFor(type),
    elements: els,
    schema: cloneSchema(schema),
    accent,
  }
}

/** 整篇还原：依据已生成 SlideSchema[] 依次排版（demo / 导入用） */
export function schemasToSlides(schemas: SlideSchema[]): EditorSlide[] {
  let transitionCount = 0
  return schemas.map((s, i) => {
    const isTrans = s.type === 'transition'
    const slide = schemaToSlide(s, {
      accent: accentAt(i),
      transitionIndex: isTrans ? transitionCount : undefined,
    })
    if (isTrans) transitionCount += 1
    return slide
  })
}

export function slideToSchema(slide: EditorSlide): SlideSchema {
  return cloneSchema(slide.schema)
}

/** 依据元素当前文本刷新 schema 内容（导出前保险调用） */
export function syncSlideFromElements(slide: EditorSlide): void {
  const schema = slide.schema
  if (!schema.data) schema.data = {}
  for (const el of slide.elements) syncElementToSchema(schema, el)
  // 同步后为 item 数组中的对象补默认字段，避免导出缺 text
  const d = schema.data
  if (Array.isArray(d.items)) {
    d.items = d.items.map((it) => (typeof it === 'object' && it ? { title: it.title ?? '', text: it.text ?? '' } : it))
  }
}

// ------------------------------------------------------------------
// 大纲解析（用于 Demo 模式与生成页进度预估）
// ------------------------------------------------------------------
export interface OutlineSection {
  title: string
  subheads: { title: string; bullets: string[] }[]
}

export interface OutlinePlan {
  title: string
  subtitle: string
  sections: OutlineSection[]
}

export function parseOutline(markdown: string): OutlinePlan {
  const lines = markdown.split('\n').map((l) => l.trim())
  let title = ''
  let subtitle = ''
  const sections: OutlineSection[] = []
  let cur: OutlineSection | null = null
  let curSub: { title: string; bullets: string[] } | null = null

  const ensureSub = (): { title: string; bullets: string[] } => {
    if (!cur) {
      cur = { title: '', subheads: [] }
      sections.push(cur)
    }
    if (!curSub) {
      curSub = { title: '', bullets: [] }
      cur.subheads.push(curSub)
    }
    return curSub
  }

  for (const raw of lines) {
    if (!raw) continue
    const head = /^(#{1,6})\s+(.+)$/.exec(raw)
    if (head) {
      const level = head[1].length
      const body = head[2].trim()
      if (!body) continue
      if (level === 1) {
        if (!title) title = body
      } else if (level === 2) {
        cur = { title: body, subheads: [] }
        curSub = null
        sections.push(cur)
      } else {
        // ### 及以下作为当前章节下的小节
        if (!cur) {
          cur = { title: '', subheads: [] }
          sections.push(cur)
        }
        curSub = { title: body, bullets: [] }
        cur.subheads.push(curSub)
      }
      continue
    }
    if (/^[-*•]/.test(raw)) {
      const bullet = raw.replace(/^[-*•]\s*/, '').trim()
      if (!bullet) continue
      const sub = ensureSub()
      sub.bullets.push(bullet)
    } else {
      // 游离正文：无小节时当作封面副标题
      if (!cur && !subtitle) subtitle = raw
    }
  }
  if (!title && sections.length) title = sections[0].title
  if (!sections.length && title) {
    sections.push({ title, subheads: [] })
  }
  return { title: title || '未命名演示', subtitle, sections }
}

/** 估算生成页数，用于进度百分比 */
export function estimateSlideCount(md: string): number {
  const plan = parseOutline(md)
  const n = plan.sections.length
  if (!n) return 6
  return 2 + n * 2 + 1 // 封面 + 目录 + 每节(过渡+内容) + 结束
}

/** 按解析的大纲构造整套内容 Schema（Demo 数据源） */
export function schemasFromOutline(md: string): SlideSchema[] {
  const plan = parseOutline(md)
  const schemas: SlideSchema[] = []
  schemas.push({ type: 'cover', data: { title: plan.title, text: plan.subtitle || '一份由 AiPPT 智能生成的演示文稿' } })
  schemas.push({
    type: 'contents',
    data: { items: plan.sections.filter((s) => s.title).map((s) => s.title) },
  })
  if (!plan.sections.length) {
    schemas.push({ type: 'end', data: {} })
    return schemas
  }
  for (const sec of plan.sections) {
    if (sec.title) {
      schemas.push({ type: 'transition', data: { title: sec.title, text: '' } })
    }
    const items: ContentItem[] = []
    for (const sub of sec.subheads) {
      if (sub.title) {
        items.push({ title: sub.title, text: sub.bullets.join('\n') })
      } else {
        sub.bullets.forEach((b) => items.push({ title: '', text: b }))
      }
    }
    if (!sec.title && !items.length) {
      // 大纲退化：仅标题无小节，仍给一页空内容
      items.push({ title: '', text: '（该章节暂无小节要点）' })
    }
    schemas.push({ type: 'content', data: { title: sec.title || plan.title, items } })
  }
  schemas.push({ type: 'end', data: {} })
  return schemas
}

/** 演示用样例大纲 */
export const SAMPLE_OUTLINE = `# 电动汽车产业发展报告

## 市场现状与规模
### 全球销量快速增长
- 2025 年全球新能源汽车销量突破 2000 万辆
- 渗透率首次超过 25%，进入规模放量阶段
### 中国市场持续领跑
- 中国占全球市场份额六成以上
- 出口量连续三年保持全球第一

## 核心技术趋势
### 动力电池技术
- 固态电池进入量产前夜
- 能量密度正向 400Wh/kg 迈进
### 智能驾驶
- 高阶辅助驾驶渗透率快速提升
- L3 级法规在多个城市逐步落地

## 产业链竞争格局
### 整车厂商
- 新势力与传统车企加速电动化转型
- 价格竞争激烈，行业洗牌加速
### 供应链
- 电池、芯片、电机等核心环节国产化率提升

## 未来展望
### 基础设施
- 充电桩、换电站加速建设
- 车网互动（V2G）等新业态兴起
### 政策方向
- 双碳目标驱动绿色交通转型
- 鼓励技术创新与产业协同
`

export function demoDeck(): EditorSlide[] {
  return schemasToSlides(schemasFromOutline(SAMPLE_OUTLINE))
}
