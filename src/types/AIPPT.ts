// Slide Schema 类型定义（对应 SRS 第 6.1 节数据字典）
// 前端与后端共同遵守这份契约，改接口时先改这里。

export type SlideType = 'cover' | 'contents' | 'transition' | 'content' | 'end' | 'reference'

export type ChartType = 'line' | 'bar' | 'pie' | 'column' | 'ring' | 'area' | 'radar'

export interface ChartSeries {
  name: string
  data: number[]
}

export interface ChartItem {
  kind: 'chart'
  title: string
  text: string
  chartType: ChartType
  labels: string[]
  series: ChartSeries[]
  options?: Record<string, unknown>
}

export interface ImageItem {
  kind: 'image'
  title?: string
  text?: string
  url?: string
}

export interface ContentItem {
  title?: string
  text?: string
  kind?: 'chart' | 'image'
  // 当 kind='chart' 时携带图表元信息（对齐 ChartItem）
  chartType?: ChartType
  labels?: string[]
  series?: ChartSeries[]
  // 当 kind='image' 时携带图片地址
  url?: string
}

export interface SlideData {
  title?: string
  text?: string
  items?: (ContentItem | string)[]
  references?: string[]
}

export interface SlideSchema {
  type: SlideType
  data?: SlideData
}

export interface TemplateInfo {
  name: string
  id: string
  cover: string
}
