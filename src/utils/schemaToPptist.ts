// SlideSchema[] → PPTist Slide[]（版式转换器）
// ------------------------------------------------------------------
// 生成契约（外层 types/AIPPT.ts）只有粗粒度内容（type + title/text/items/references），
// 不含几何/样式。本模块把它"排版"成 PPTist 的富元素幻灯片（1000 × 562.5 坐标系），
// 进入 /editor 后由 PPTist 提供元素级二次编辑、导出与放映。
//
// 坐标系：PPTist 画布 = viewportSize(1000) × viewportSize*viewportRatio(0.5625)。
// 文本元素 content 为 HTML；PPTist 富文本可解析 <p> / <strong> / <span style="font-size/color">。
// 不依赖任何外部模板素材（用户决策：自写通用版式）。
import type {
  ChartItem,
  SlideData,
  SlideSchema,
} from '../types/AIPPT'
import { accentAt, uid } from './aippt'
import type {
  PPTChartElement,
  PPTElement,
  PPTShapeElement,
  PPTTextElement,
  Slide,
  SlideBackground,
  SlideType as PptistSlideType,
  TextAlignVertical,
} from '../pptist/types/slides'

export const VIEW_W = 1000
export const VIEW_H = 1000 * 0.5625 // 562.5
const INK = '#1f2340' // 深色正文（浅底）
const PAPER = '#ffffff' // 页面底色（浅色页）
const DARK_TEXT = '#ffffff' // 深底正文
const DARK_BAR = '#a5b4fc' // 深底上的装饰亮色

// 把外层 SlideType 归并到 PPTist 认可的 Slide.type（reference 无对应，归入 content）
const TYPE_MAP: Record<string, PptistSlideType> = {
  cover: 'cover',
  contents: 'contents',
  transition: 'transition',
  content: 'content',
  reference: 'content',
  end: 'end',
}

// ------------------------------------------------------------------
// 小工具
// ------------------------------------------------------------------
function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

interface PStyle {
  size?: number
  color?: string
  bold?: boolean
  align?: 'left' | 'center' | 'right'
}
/** 生成一个 <p> 段落（PPTist 富文本规范内联样式） */
function para(text: string, o: PStyle = {}): string {
  const size = o.size ?? 20
  const color = o.color ?? INK
  const styles = [`font-size:${size}px`, `color:${color}`]
  if (o.bold) styles.push('font-weight:bold')
  const pStyle = o.align && o.align !== 'left' ? ` style="text-align:${o.align}"` : ''
  return `<p${pStyle}><span style="${styles.join('; ')}">${esc(text)}</span></p>`
}
interface TextBox {
  x: number
  y: number
  w: number
  h: number
  html: string
  valign?: TextAlignVertical
  lineHeight?: number
  paragraphSpace?: number
}
function textEl(box: TextBox): PPTTextElement {
  const el: PPTTextElement = {
    type: 'text',
    id: uid(),
    left: box.x,
    top: box.y,
    width: box.w,
    height: box.h,
    rotate: 0,
    defaultFontName: '',
    defaultColor: INK,
    content: box.html,
    fixedHeight: true,
    vAlign: box.valign ?? 'top',
    inset: [0, 0, 0, 0],
  }
  if (box.lineHeight) el.lineHeight = box.lineHeight
  if (box.paragraphSpace) el.paragraphSpace = box.paragraphSpace
  return el
}

function rect({ x, y, w, h, color, opacity = 1, radius = 0 }: {
  x: number; y: number; w: number; h: number; color: string; opacity?: number; radius?: number
}): PPTShapeElement {
  // 用圆角矩形路径（避免引入 shapes 配置的 pathFormula 依赖）
  const r = Math.min(radius, w / 2, h / 2)
  const d = `M${r} 0 H${w - r} Q${w} 0 ${w} ${r} V${h - r} Q${w} ${h} ${w - r} ${h} H${r} Q0 ${h} 0 ${h - r} V${r} Q0 0 ${r} 0 Z`
  return {
    type: 'shape',
    id: uid(),
    left: x,
    top: y,
    width: w,
    height: h,
    rotate: 0,
    viewBox: [w, h],
    path: d,
    fixedRatio: false,
    fill: color,
    opacity,
  }
}

function chartColors(accent: string): string[] {
  return [accent, '#0ea5e9', '#f59e0b', '#10b981', '#ec4899']
}

function chartEl(item: ChartItem, box: { x: number; y: number; w: number; h: number }, accent: string): PPTChartElement {
  const series = (item.series || []).map((s) => s.data)
  return {
    type: 'chart',
    id: uid(),
    left: box.x,
    top: box.y,
    width: box.w,
    height: box.h,
    rotate: 0,
    chartType: item.chartType,
    data: {
      labels: item.labels || [],
      legends: (item.series || []).map((s) => s.name),
      series,
    },
    options: {},
    themeColors: chartColors(accent),
    textColor: '#9aa2b5',
    lineColor: '#e2e6f0',
  }
}

/** 数值补零用于目录/过渡的编号 */
function num(n: number): string {
  return String(n).padStart(2, '0')
}

// ------------------------------------------------------------------
// 各类页面版式
// ------------------------------------------------------------------
interface LayoutCtx {
  schema: SlideSchema
  data: SlideData
  accent: string
  index: number // 全局序号（用于章节编号）
  slideNo: number
}
type ElementsFactory = (ctx: LayoutCtx) => { elements: PPTElement[]; background?: SlideBackground }

function titleHeader(data: SlideData, accent: string, y = 84): PPTElement[] {
  const els: PPTElement[] = []
  if (data.title) {
    els.push(textEl({
      x: 100, y, w: 800, h: 68,
      html: para(data.title, { size: 40, color: INK, bold: true }),
      valign: 'middle',
    }))
    els.push(rect({ x: 100, y: y + 74, w: 64, h: 7, color: accent, radius: 3 }))
  }
  return els
}

const coverLayout: ElementsFactory = ({ data }) => {
  const els: PPTElement[] = []
  const bg: SlideBackground = { type: 'solid', color: '#312e81' }
  els.push(rect({ x: 0, y: 0, w: VIEW_W, h: 14, color: '#6366f1' }))
  els.push(rect({ x: 426, y: 190, w: 148, h: 6, color: DARK_BAR, radius: 3 }))
  const title = data.title || '演示文稿'
  els.push(textEl({
    x: 60, y: 228, w: 880, h: 110,
    html: para(title, { size: 56, color: DARK_TEXT, bold: true, align: 'center' }),
    valign: 'middle',
  }))
  if (data.text) {
    els.push(textEl({
      x: 60, y: 346, w: 880, h: 60,
      html: para(data.text, { size: 24, color: 'rgba(255,255,255,0.82)', align: 'center' }),
      valign: 'middle',
    }))
  }
  return { elements: els, background: bg }
}

const contentsLayout: ElementsFactory = ({ data, accent, slideNo }) => {
  const els: PPTElement[] = []
  const items = (data.items || []).filter((it) => typeof it === 'string') as string[]
  els.push(...titleHeader(data, accent, 84))
  if (items.length) {
    const limit = Math.min(items.length, 8)
    const rows = items.slice(0, limit).map((it, i) =>
      `<p><span style="font-size:22px;color:${accent};font-weight:bold">${num(i + 1)}</span><span style="font-size:22px;color:${INK}">&nbsp;&nbsp;&nbsp;${esc(it)}</span></p>`,
    )
    if (items.length > limit) {
      rows.push(`<p><span style="font-size:18px;color:#b7bccd">&nbsp;&nbsp;&nbsp;…… 共 ${items.length} 条</span></p>`)
    }
    els.push(textEl({
      x: 112, y: 200, w: 800, h: 320,
      html: rows.join(''),
      lineHeight: 1.55,
      paragraphSpace: 16,
    }))
  }
  els.push(textEl({
    x: 880, y: 522, w: 96, h: 26,
    html: para(String(slideNo + 1).padStart(2, '0'), { size: 16, color: '#c0c4d2', align: 'right' }),
  }))
  return { elements: els, background: { type: 'solid', color: PAPER } }
}

const transitionLayout: ElementsFactory = ({ data, accent }) => {
  const bg: SlideBackground = { type: 'solid', color: '#4c1d95' }
  const els: PPTElement[] = []
  els.push(rect({ x: 0, y: 0, w: VIEW_W, h: 10, color: '#8b5cf6' }))
  const title = data.title || ''
  if (title) {
    els.push(textEl({
      x: 60, y: 216, w: 880, h: 92,
      html: para(title, { size: 48, color: DARK_TEXT, bold: true, align: 'center' }),
      valign: 'middle',
    }))
  }
  if (data.text) {
    els.push(textEl({
      x: 140, y: 322, w: 720, h: 46,
      html: para(data.text, { size: 22, color: 'rgba(255,255,255,0.75)', align: 'center' }),
      valign: 'middle',
    }))
  }
  els.push(rect({ x: 470, y: 368, w: 60, h: 5, color: DARK_BAR, radius: 2 }))
  return { elements: els, background: bg }
}

interface BodyItem {
  title?: string
  text?: string
}
const contentLayout: ElementsFactory = ({ data, accent }) => {
  const els: PPTElement[] = [...titleHeader(data, accent, 84)]
  const items = data.items || []
  const textual: BodyItem[] = []
  const charts: ChartItem[] = []
  const images: { title?: string; text?: string; url?: string }[] = []
  for (const it of items) {
    const kind = (it as { kind?: string } | null)?.kind
    if (typeof it === 'string') textual.push({ text: it })
    else if (kind === 'chart' && (it as ChartItem).labels) charts.push(it as ChartItem)
    else if (kind === 'image') images.push(it as { title?: string; text?: string; url?: string })
    else textual.push({ title: (it as BodyItem).title, text: (it as BodyItem).text })
  }

  // 文本部分
  const textPps: string[] = []
  for (const it of textual) {
    if (it.title) {
      textPps.push(`<p><span style="font-size:22px;color:${INK};font-weight:bold">${esc(it.title)}</span></p>`)
      if (it.text) textPps.push(`<p><span style="font-size:19px;color:#5b6275">${esc(it.text)}</span></p>`)
    } else if (it.text) {
      textPps.push(`<p><span style="font-size:21px;color:${INK}">·&nbsp;&nbsp;${esc(it.text)}</span></p>`)
    }
  }
  if (images.length && !textPps.length) {
    const names = images.map((i) => i.title).filter(Boolean).join('、') || '由模型按内容配图'
    textPps.push(`<p><span style="font-size:18px;color:#9aa2b5">（本页配图位：${names}）</span></p>`)
  }

  if (charts.length) {
    // 有图表时：要点在左列、图表在右列
    if (textPps.length) {
      els.push(textEl({
        x: 90, y: 206, w: 500, h: 300,
        html: textPps.join(''),
        lineHeight: 1.5,
        paragraphSpace: 12,
      }))
    }
    els.push(chartEl(charts[0], { x: 620, y: 186, w: 340, h: 340 }, accent))
  } else {
    els.push(textEl({
      x: 100, y: 206, w: 800, h: 300,
      html: textPps.join('') || para('（本页暂无文字内容）', { size: 20, color: '#9aa2b5' }),
      lineHeight: 1.6,
      paragraphSpace: 12,
    }))
  }
  return { elements: els, background: { type: 'solid', color: PAPER } }
}

const referenceLayout: ElementsFactory = ({ data }) => {
  const els: PPTElement[] = [...titleHeader(data, '#0ea5e9', 84)]
  const refs = data.references || []
  const html = refs.map((r, i) =>
    `<p><span style="font-size:15px;color:#0ea5e9;font-weight:bold">[${i + 1}]</span><span style="font-size:18px;color:#3f4657">&nbsp;&nbsp;${esc(r)}</span></p>`,
  ).join('')
  els.push(textEl({
    x: 100, y: 206, w: 800, h: 310,
    html: html || para('（暂无参考文献）', { size: 18, color: '#9aa2b5' }),
    lineHeight: 1.7,
    paragraphSpace: 12,
  }))
  return { elements: els, background: { type: 'solid', color: PAPER } }
}

const endLayout: ElementsFactory = ({ data }) => {
  const bg: SlideBackground = { type: 'solid', color: '#1e1b4b' }
  const els: PPTElement[] = []
  els.push(rect({ x: 0, y: 0, w: VIEW_W, h: 12, color: '#8b5cf6' }))
  els.push(textEl({
    x: 60, y: 216, w: 880, h: 96,
    html: para(data.title || '谢谢观看', { size: 54, color: DARK_TEXT, bold: true, align: 'center' }),
    valign: 'middle',
  }))
  els.push(textEl({
    x: 60, y: 326, w: 880, h: 40,
    html: para('Thanks for watching', { size: 18, color: 'rgba(255,255,255,0.6)', align: 'center' }),
  }))
  return { elements: els, background: bg }
}

const LAYOUTS: Record<string, ElementsFactory> = {
  cover: coverLayout,
  contents: contentsLayout,
  transition: transitionLayout,
  content: contentLayout,
  reference: referenceLayout,
  end: endLayout,
}

// ------------------------------------------------------------------
// 对外主入口
// ------------------------------------------------------------------
export function schemaToPptSlide(schema: SlideSchema, opts: { accent?: string; slideNo?: number } = {}): Slide {
  const data = schema.data || {}
  const factory = LAYOUTS[schema.type] || contentLayout
  const ctx: LayoutCtx = {
    schema,
    data,
    accent: opts.accent || accentAt(opts.slideNo ?? 0),
    index: opts.slideNo ?? 0,
    slideNo: opts.slideNo ?? 0,
  }
  const { elements, background } = factory(ctx)
  return {
    id: uid(),
    elements,
    background,
    type: TYPE_MAP[schema.type] || 'content',
  }
}

export function schemasToPptistSlides(schemas: SlideSchema[]): Slide[] {
  return schemas.map((s, i) => schemaToPptSlide(s, { accent: accentAt(i), slideNo: i }))
}

/** 空态兜底：生成一页空白封面，保证编辑器打开时总有可编辑画布 */
export function makeBlankCover(title = '未命名演示文稿'): Slide {
  return schemaToPptSlide({ type: 'cover', data: { title, text: '双击进入编辑，或返回「生成」重新生成内容' } })
}
