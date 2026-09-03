import { defineStore } from 'pinia'

// 「主题录入 → 大纲编辑 → 模板选择」向导的跨页共享状态（P01/P02/P03）
// markdown 是权威大纲结果：P01 生成后写入，P02 编辑后覆盖写回，P03 读取做内容生成。

export type GenSource = 'text' | 'file'

export const useGenerationStore = defineStore('generation', {
  state: () => ({
    topic: '', // 录入的主题 / 文档内容（回填用）
    language: '中文',
    model: 'qwen-turbo-latest',
    markdown: '', // 权威大纲 markdown
    source: 'text' as GenSource,
  }),
  actions: {
    setTopic(topic: string) {
      this.topic = topic
    },
    setParams(params: { language?: string; model?: string; source?: GenSource }) {
      if (params.language !== undefined) this.language = params.language
      if (params.model !== undefined) this.model = params.model
      if (params.source !== undefined) this.source = params.source
    },
    setMarkdown(markdown: string) {
      this.markdown = markdown
    },
    reset() {
      this.topic = ''
      this.language = '中文'
      this.model = 'qwen-turbo-latest'
      this.markdown = ''
      this.source = 'text'
    },
  },
})
