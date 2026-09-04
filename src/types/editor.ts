// 编辑器领域模型
// ------------------------------------------------
// 说明：
//  - 后端/SSE 生成的契约是 `SlideSchema`(见 types/AIPPT.ts，粗粒度：只有 type + 文本)。
//  - 编辑器在 1920×1080 的逻辑坐标系里把它们“排版”成带坐标/样式的元素幻灯片，
//    从而获得 PPTist 式的选中 / 拖拽 / 缩放 / 编辑能力。
//  - `EditorSlide.schema` 是内容“单一事实源”，元素文本通过 `ref` 路径双向同步回 schema，
//    便于随时还原为 `SlideSchema`（导出 JSON / 供放映页等消费）。
import type { ChartItem, SlideSchema, SlideType } from './AIPPT'

/** 幻灯片逻辑画布尺寸（与模板/PPTist 一致） */
export const SLIDE_W = 1920
export const SLIDE_H = 1080

export type TextAlign = 'left' | 'center' | 'right'
export type TextValign = 'top' | 'middle' | 'bottom'

interface BaseEl {
  id: string
  type: 'text' | 'rect' | 'chart'
  left: number
  top: number
  width: number
  height: number
  /** 回写 schema 的字段路径，如 'title' / 'text' / 'items.0' / 'items.2.title' */
  ref?: string
  /** decorative=true 的元素不回写 schema（如“目录”占位标题），重排版时会被重建 */
  decorative?: boolean
  lock?: boolean
}

export interface TextEl extends BaseEl {
  type: 'text'
  text: string
  fontSize: number
  fontWeight?: number
  italic?: boolean
  color: string
  align: TextAlign
  valign?: TextValign
  lineHeight?: number
  letterSpacing?: number
}

export interface RectEl extends BaseEl {
  type: 'rect'
  bg: string
  radius: number
  borderColor?: string
}

export interface ChartEl extends BaseEl {
  type: 'chart'
  chart: ChartItem
}

export type SlideElement = TextEl | RectEl | ChartEl

/** 页面背景：直接存 CSS background 值，便于在面板中切换预设 */
export interface SlideBackground {
  css: string
  dark?: boolean
}

export interface EditorSlide {
  id: string
  type: SlideType
  background: SlideBackground
  elements: SlideElement[]
  /** 内容源：与元素文本双向同步 */
  schema: SlideSchema
  /** 版式主色（由排版引擎选择，用于重排、导出色块） */
  accent: string
}
