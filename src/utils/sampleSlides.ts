import type { SlideSchema } from '../types/AIPPT'

// 放映/编辑器尚未接通真实后端与 PPTist 时的示例幻灯片。
// 仅用于让放映页、导出页、演讲者视图等前端 UI 有内容可演示，
// 接入真实数据后 store.slides 会替换掉这组数据。
export const sampleSlides: SlideSchema[] = [
  {
    type: 'cover',
    data: {
      title: '新能源汽车行业发展趋势',
      text: '2026 年市场观察与前瞻 —— 基于数据驱动的战略汇报',
    },
  },
  {
    type: 'contents',
    data: {
      title: '目录',
      items: ['行业整体规模与增速', '三电核心技术演进', '智能化与自动驾驶', '竞争格局与主要玩家', '未来展望与投资建议'],
    },
  },
  {
    type: 'transition',
    data: { title: '01 行业整体规模与增速' },
  },
  {
    type: 'content',
    data: {
      title: '市场规模稳步增长',
      text: '2025 年全球新能源乘用车销量突破 2000 万辆，渗透率提升至 28%。',
      items: [
        '中国：销量占比超 60%，是全球最大单一市场',
        '欧洲：补贴退坡背景下增速放缓，但基盘稳固',
        '美国：政策刺激下迎来新一轮补库周期',
      ],
    },
  },
  {
    type: 'content',
    data: {
      title: '核心数据一览',
      items: [
        { kind: 'chart', title: '季度销量', text: '柱状图：近 8 季度销量', chartType: 'column', labels: [], series: [] },
        { kind: 'image', title: '渗透率示意', text: '配图：新能源渗透率走势', url: '' },
      ],
    },
  },
  {
    type: 'end',
    data: {
      title: '感谢聆听',
      text: '欢迎交流与指正',
      references: ['数据来源：中汽协 2026-08 月报'],
    },
  },
]
