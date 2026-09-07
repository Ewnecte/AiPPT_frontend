// SlideSchema[] → PPTist Slide[]（版式转换器）
// ------------------------------------------------------------------
// 生成契约（外层 types/AIPPT.ts）只有粗粒度内容（type + title/text/items/references），
// 不含几何/样式。本模块把它"排版"成 PPTist 的富元素幻灯片（1000 × 562.5 坐标系），
// 进入 /editor 后由 PPTist 提供元素级二次编辑、导出与放映。
//
// 坐标系：PPTist 画布 = viewportSize(1000) × viewportSize*viewportRatio(0.5625)。
// 文本元素 content 为 HTML；PPTist 富文本可解析 <p> / <strong> / <span style="font-size/color">。
// 主题：可传入模板 theme（themeColors/背景/字体色），整份 PPT 视觉风格随之改变；
//       未传模板时回落为内置默认紫蓝风格。
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

// ------------------------------------------------------------------
// 主题 / 调色板
// ------------------------------------------------------------------
/** 模板 theme（来自后端 template_*.json 的 theme 节点，字段均可选） */
export interface DeckTheme {
  name?: string
  themeColors?: string[]
  backgroundColor?: string
  fontColor?: string
  fontName?: string
}

/** 排版用调色板（由模板 theme 生成，缺省回落内置默认值） */
interface Palette {
  paper: string // 浅色页背景
  ink: string // 浅底正文（标题/要点）
  sub: string // 浅底次要文字
  faint: string // 弱文字 / 页码
  darkText: string // 深底正文（通常白）
  deep: string // 深页背景（cover）
  deepAlt: string // 深页背景（transition）
  deepEnd: string // 深页背景（end）
  top: string // 深页顶部色带
  bar: string // 深底亮色装饰条
  accentFor(i: number): string // 每页主题主色（accent）
}

// 默认（无模板）时的内置紫蓝风格
const DEFAULT_PAPER = '#ffffff'
const DEFAULT_INK = '#1f2340'
const DEFAULT_COLORS = ['#6366f1', '#8b5cf6', '#0ea5e9', '#a855f7', '#f59e0b', '#14b8a6']

/** hex(#rgb/#rrggbb) → [r,g,b] 0-255；解析失败返回 null */
function hexToRgb(hex: string): [number, number, number] | null {
  let h = String(hex).trim().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map((c) => c + c).join('')
  if (!/^[0-9a-f]{6}$/i.test(h)) return null
  const n = parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)))
}

/** 把颜色往 target(#000/#fff 等) 混合 t(0-1)，得到新 hex */
function mixToward(hex: string, target: string, t: number): string {
  const a = hexToRgb(hex)
  const b = hexToRgb(target)
  if (!a || !b) return hex
  const [r1, g1, b1] = a
  const [r2, g2, b2] = b
  const r = clamp255(r1 + (r2 - r1) * t)
  const g = clamp255(g1 + (g2 - g1) * t)
  const bl = clamp255(b1 + (b2 - b1) * t)
  return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, '0')}`
}

/** 感知亮度 0-1（近似），用于判断深/浅背景与文字反色 */
function luminance(hex: string): number {
  const c = hexToRgb(hex)
  if (!c) return 1
  return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255
}

function validHex(v: unknown): v is string {
  return typeof v === 'string' && hexToRgb(v) !== null
}

function buildPalette(theme?: DeckTheme | null): Palette {
  const colors = (theme?.themeColors || []).filter(validHex)
  const c0 = colors[0] || DEFAULT_COLORS[0]
  const c1 = colors[1] || DEFAULT_COLORS[1]

  const paper = validHex(theme?.backgroundColor) ? (theme!.backgroundColor as string) : DEFAULT_PAPER
  const dark = luminance(paper) < 0.45
  const ink = validHex(theme?.fontColor) && !dark ? (theme!.fontColor as string) : dark ? '#ffffff' : DEFAULT_INK

  return {
    paper,
    ink,
    sub: dark ? 'rgba(255,255,255,0.75)' : '#5b6275',
    faint: dark ? 'rgba(255,255,255,0.45)' : '#9aa2b5',
    darkText: '#ffffff',
    // 深底页：主色向深压暗，保证白字可读且保留模板色相
    deep: mixToward(c0, '#0d0a24', dark ? 0.35 : 0.66),
    deepAlt: mixToward(c1, '#0d0a24', dark ? 0.3 : 0.58),
    deepEnd: mixToward(c0, '#0d0a24', dark ? 0.42 : 0.74),
    top: c0,
    bar: mixToward(c0, '#ffffff', 0.55),
    accentFor: (i) => (colors.length ? colors[i % colors.length] : accentAt(i)),
  }
}

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
  const color = o.color ?? '#1f2340'
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
function textEl(box: TextBox, defaultColor = DEFAULT_INK): PPTTextElement {
  const el: PPTTextElement = {
    type: 'text',
    id: uid(),
    left: box.x,
    top: box.y,
    width: box.w,
    height: box.h,
    rotate: 0,
    defaultFontName: '',
    defaultColor,
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
  palette: Palette
  index: number // 全局序号（用于章节编号）
  slideNo: number
}
type ElementsFactory = (ctx: LayoutCtx) => { elements: PPTElement[]; background?: SlideBackground }

function titleHeader(data: SlideData, accent: string, y: number, palette: Palette): PPTElement[] {
  const els: PPTElement[] = []
  if (data.title) {
    els.push(textEl({
      x: 100, y, w: 800, h: 68,
      html: para(data.title, { size: 40, color: palette.ink, bold: true }),
      valign: 'middle',
    }, palette.ink))
    els.push(rect({ x: 100, y: y + 74, w: 64, h: 7, color: accent, radius: 3 }))
  }
  return els
}

const coverLayout: ElementsFactory = ({ data, palette }) => {
  const els: PPTElement[] = []
  const bg: SlideBackground = { type: 'solid', color: palette.deep }
  els.push(rect({ x: 0, y: 0, w: VIEW_W, h: 14, color: palette.top }))
  els.push(rect({ x: 426, y: 190, w: 148, h: 6, color: palette.bar, radius: 3 }))
  const title = data.title || '演示文稿'
  els.push(textEl({
    x: 60, y: 228, w: 880, h: 110,
    html: para(title, { size: 56, color: palette.darkText, bold: true, align: 'center' }),
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

const contentsLayout: ElementsFactory = ({ data, accent, palette, slideNo }) => {
  const els: PPTElement[] = []
  const items = (data.items || []).filter((it) => typeof it === 'string') as string[]
  els.push(...titleHeader(data, accent, 84, palette))
  if (items.length) {
    const limit = Math.min(items.length, 8)
    const rows = items.slice(0, limit).map((it, i) =>
      `<p><span style="font-size:22px;color:${accent};font-weight:bold">${num(i + 1)}</span><span style="font-size:22px;color:${palette.ink}">&nbsp;&nbsp;&nbsp;${esc(it)}</span></p>`,
    )
    if (items.length > limit) {
      rows.push(`<p><span style="font-size:18px;color:${palette.faint}">&nbsp;&nbsp;&nbsp;…… 共 ${items.length} 条</span></p>`)
    }
    els.push(textEl({
      x: 112, y: 200, w: 800, h: 320,
      html: rows.join(''),
      lineHeight: 1.55,
      paragraphSpace: 16,
    }, palette.ink))
  }
  els.push(textEl({
    x: 880, y: 522, w: 96, h: 26,
    html: para(String(slideNo + 1).padStart(2, '0'), { size: 16, color: palette.faint, align: 'right' }),
  }))
  return { elements: els, background: { type: 'solid', color: palette.paper } }
}

const transitionLayout: ElementsFactory = ({ data, palette }) => {
  const bg: SlideBackground = { type: 'solid', color: palette.deepAlt }
  const els: PPTElement[] = []
  els.push(rect({ x: 0, y: 0, w: VIEW_W, h: 10, color: palette.top }))
  const title = data.title || ''
  if (title) {
    els.push(textEl({
      x: 60, y: 216, w: 880, h: 92,
      html: para(title, { size: 48, color: palette.darkText, bold: true, align: 'center' }),
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
  els.push(rect({ x: 470, y: 368, w: 60, h: 5, color: palette.bar, radius: 2 }))
  return { elements: els, background: bg }
}

interface BodyItem {
  title?: string
  text?: string
}
const contentLayout: ElementsFactory = ({ data, accent, palette }) => {
  const els: PPTElement[] = [...titleHeader(data, accent, 84, palette)]
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
      textPps.push(`<p><span style="font-size:22px;color:${palette.ink};font-weight:bold">${esc(it.title)}</span></p>`)
      if (it.text) textPps.push(`<p><span style="font-size:19px;color:${palette.sub}">${esc(it.text)}</span></p>`)
    } else if (it.text) {
      textPps.push(`<p><span style="font-size:21px;color:${palette.ink}">·&nbsp;&nbsp;${esc(it.text)}</span></p>`)
    }
  }
  if (images.length && !textPps.length) {
    const names = images.map((i) => i.title).filter(Boolean).join('、') || '由模型按内容配图'
    textPps.push(`<p><span style="font-size:18px;color:${palette.faint}">（本页配图位：${names}）</span></p>`)
  }

  if (charts.length) {
    // 有图表时：要点在左列、图表在右列
    if (textPps.length) {
      els.push(textEl({
        x: 90, y: 206, w: 500, h: 300,
        html: textPps.join(''),
        lineHeight: 1.5,
        paragraphSpace: 12,
      }, palette.ink))
    }
    els.push(chartEl(charts[0], { x: 620, y: 186, w: 340, h: 340 }, accent))
  } else {
    els.push(textEl({
      x: 100, y: 206, w: 800, h: 300,
      html: textPps.join('') || para('（本页暂无文字内容）', { size: 20, color: palette.faint }),
      lineHeight: 1.6,
      paragraphSpace: 12,
    }, palette.ink))
  }
  return { elements: els, background: { type: 'solid', color: palette.paper } }
}

const referenceLayout: ElementsFactory = ({ data, palette }) => {
  const accent = palette.accentFor(999) // 引用页用主题主色
  const els: PPTElement[] = [...titleHeader(data, accent, 84, palette)]
  const refs = data.references || []
  const html = refs.map((r, i) =>
    `<p><span style="font-size:15px;color:${accent};font-weight:bold">[${i + 1}]</span><span style="font-size:18px;color:${palette.sub}">&nbsp;&nbsp;${esc(r)}</span></p>`,
  ).join('')
  els.push(textEl({
    x: 100, y: 206, w: 800, h: 310,
    html: html || para('（暂无参考文献）', { size: 18, color: palette.faint }),
    lineHeight: 1.7,
    paragraphSpace: 12,
  }, palette.ink))
  return { elements: els, background: { type: 'solid', color: palette.paper } }
}

const endLayout: ElementsFactory = ({ data, palette }) => {
  const bg: SlideBackground = { type: 'solid', color: palette.deepEnd }
  const els: PPTElement[] = []
  els.push(rect({ x: 0, y: 0, w: VIEW_W, h: 12, color: palette.top }))
  els.push(textEl({
    x: 60, y: 216, w: 880, h: 96,
    html: para(data.title || '谢谢观看', { size: 54, color: palette.darkText, bold: true, align: 'center' }),
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
export function schemaToPptSlide(
  schema: SlideSchema,
  opts: { accent?: string; slideNo?: number; theme?: DeckTheme | null } = {},
): Slide {
  const data = schema.data || {}
  const palette = buildPalette(opts.theme)
  const factory = LAYOUTS[schema.type] || contentLayout
  const ctx: LayoutCtx = {
    schema,
    data,
    accent: opts.accent || palette.accentFor(opts.slideNo ?? 0),
    palette,
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

/** 整批转换；theme 传入所选模板主题（每页主色循环取 themeColors），缺省内置紫蓝 */
export function schemasToPptistSlides(schemas: SlideSchema[], theme?: DeckTheme | null): Slide[] {
  return schemas.map((s, i) => schemaToPptSlide(s, { slideNo: i, theme }))
}

/** 空态兜底：生成一页空白封面，保证编辑器打开时总有可编辑画布 */
export function makeBlankCover(title = '未命名演示文稿'): Slide {
  return schemaToPptSlide({ type: 'cover', data: { title, text: '双击进入编辑，或返回「生成」重新生成内容' } })
}
