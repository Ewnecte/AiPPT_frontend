import { defineStore } from 'pinia'

// 「大纲生成 → 大纲编辑 → 选择模板」向导的跨页共享状态（P01/P02/P03）
// markdown 是权威大纲结果：P01 生成后写入，P02 编辑后覆盖写回，P03 读取并连同模板
// 配置交接给 P04（见 draft store 的 meta）做 PPT 逐页生成。
// userId/fileId 用于「上传文档 → 知识库检索 → 生成 PPT」链路：P01 上传时生成唯一
// fileId 并写库，P03 选择「上传资料」来源时用它调用后端 /tools/aippt_by_id。

export type GenSource = 'text' | 'file'

// 浏览器级稳定匿名用户 id：多人共用一台设备测试时知识库按 user 隔离。
// 存放于 localStorage，跨刷新保持；拿不到 storage 时回退固定值。
const USER_KEY = 'aippt.userId'
function loadUserId(): string {
  try {
    let id = localStorage.getItem(USER_KEY)
    if (!id) {
      id = `u_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
      localStorage.setItem(USER_KEY, id)
    }
    return id
  } catch {
    return 'u_local'
  }
}

export const useGenerationStore = defineStore('generation', {
  state: () => ({
    topic: '', // 录入的主题 / 文档内容（回填用）
    language: '中文',
    model: 'deepseek-chat',
    markdown: '', // 权威大纲 markdown
    source: 'text' as GenSource,
    userId: loadUserId(), // 知识库命名空间，后端按 user_{userId} 隔离
    fileId: '', // 本会话已入库的文件 id（有值才允许走「上传资料」检索生成）
    fileName: '', // 已入库文件的原始名，仅用于界面提示
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
    /** 记录一次已入库的文件来源（成功后调用）。 */
    setUploadedFile(fileId: string, fileName: string) {
      this.fileId = fileId
      this.fileName = fileName
      this.source = 'file'
    },
    /** 清除文件来源记录（纯文本路径重新生成时调用）。 */
    clearUploadedFile() {
      this.fileId = ''
      this.fileName = ''
    },
    reset() {
      this.topic = ''
      this.language = '中文'
      this.model = 'deepseek-chat'
      this.markdown = ''
      this.source = 'text'
      // userId 保持稳定，不随重置清空；fileId/fileName 随新流程清空
      this.fileId = ''
      this.fileName = ''
    },
  },
})
