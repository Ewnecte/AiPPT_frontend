# TrainPPTAgent（AiPPT）复现实施计划

> 本文档面向"从零复现 TrainPPTAgent（AI 智能演示文稿生成系统）"这一目标，给出可照抄的工程路线：目标目录结构、各服务文件清单、依赖安装、`.env` 配置、启动顺序与端到端验证。
> 配套文档：`AiPPT-SRS.md`（需求分析报告，含 16 周开发过程参考表）。

------

## 0. 目标与范围

复现后的系统能力（与参考项目 `TrainPPTAgent-main` 对齐）：

- 用户输入主题 / 粘贴长文本 / 上传文件 → 生成 Markdown 大纲
- 大纲可在线编辑 → 解析为逐页 Slide Schema → 多智能体逐页撰写内容（含图表、配图、知识库检索）
- 内容按模板类型自动匹配填充 → 实时渲染 → 在线编辑 → 导出 PPTX/PDF/图片/JSON → 全屏放映

**不要求逐字节一致**，但需实现上述主链路与相同的服务划分、接口协议、数据格式。

------

## 1. 前置条件（环境准备）

| 项目        | 版本要求                        | 说明                                    |
| ----------- | ------------------------------- | --------------------------------------- |
| Python      | 3.10+（脚本要求 3.8+）          | 建议 3.10/3.11，ADK 依赖兼容性较好      |
| Node.js     | 16+（生产脚本检测）             | 建议 18+，Vite 5 需要                  |
| pip         | 最新                            | 用于安装后端依赖                        |
| npm         | 最新                            | 用于安装前端依赖                        |
| Git         | 任意                            | 拉取/管理代码                           |
| API Key     | 至少一个 LLM 供应商 + 一个 Embedding 供应商 | 见第 12 节配置清单            |
| 网络        | 可访问 LLM API / 搜索引擎 / Pexels | 云端模型必需                            |

**建议目录（与参考项目一致）：**

```
AiPPT/
├── SRS.md                      # 格式模板（参考）
├── SRS-Sample.md               # 示例文档（参考）
├── AiPPT-SRS.md                # 本文档配套的需求分析报告
├── AiPPT-复现实施计划.md        # 本文档
└── TrainPPTAgent-main/         # 参考项目源码（复现参照对象）
```

------

## 2. 系统总览

### 2.1 服务清单与端口

| 服务               | 目录                     | 端口  | 框架/协议                          | 职责                                   |
| ------------------ | ------------------------ | ----- | ---------------------------------- | -------------------------------------- |
| 主 API 服务        | `backend/main_api`       | 6800  | FastAPI + SSE                      | 统一入口、参数校验、A2A 客户端、流式封装 |
| 大纲生成 Agent     | `backend/simpleOutline`  | 10001 | ADK + A2A（Starlette/SSE）         | 生成 Markdown 大纲（可选微信搜索）      |
| 内容生成 Agent     | `backend/slide_agent`    | 10011 | ADK + A2A（Starlette）             | 逐页生成 Slide JSON（Writer/Checker/Controller） |
| 知识库服务         | `backend/personaldb`     | 9100  | FastAPI + ChromaDB                 | 文件解析、分块、向量化、语义检索        |
| 模拟 API（可选）   | `backend/mock_api`       | 自定义 | FastAPI                            | 无 LLM Key 时的快速 UI 联调             |
| 前端               | `frontend`               | 5173  | Vue3 + Vite + TS（PPTist）         | 录入/大纲/模板/编辑器/放映/导出         |

### 2.2 服务依赖关系

```
frontend (5173)
   └─ 代理 /api → main_api (6800)
                   ├─ A2A 调用 simpleOutline (10001)
                   ├─ A2A 调用 slide_agent  (10011)
                   │        └─ HTTP 调用 personaldb (9100)  # KnowledgeBaseSearch
                   └─ HTTP 调用 personaldb (9100)          # /upload、/files
```

**结论：启动顺序应为 `personaldb → simpleOutline → slide_agent → main_api → frontend`。**

### 2.3 目标目录结构（复现需搭建）

```
TrainPPTAgent/
├── .env                      # 统一环境配置（关键，各服务优先读取）
├── env_template.txt          # 统一配置模板
├── start.py                  # 一键启动（依赖根目录 .env）
├── deploy.sh
├── docker-compose.yml
├── backend/
│   ├── requirements.txt      # 后端顶层依赖（一键启动用）
│   ├── start_backend.py      # 后端一键启动脚本
│   ├── main_api/
│   │   ├── main.py           # 主 API 网关
│   │   ├── outline_client.py # A2A 大纲客户端封装
│   │   ├── content_client.py # A2A 内容客户端封装（含图表拆包）
│   │   ├── env_template      # 服务级环境模板
│   │   └── template/         # 模板 JSON + 封面图 + Pexels 图
│   ├── simpleOutline/
│   │   ├── main_api.py       # A2A 服务入口
│   │   ├── agent.py          # OutlineAgent
│   │   ├── prompt.py         # 大纲 Prompt
│   │   ├── tools.py          # DocumentSearch 工具
│   │   ├── weixin_search.py  # 搜狗微信搜索
│   │   ├── create_model.py   # LiteLLM 模型工厂
│   │   ├── adk_agent_executor.py
│   │   ├── a2a_client.py     # 测试客户端
│   │   └── env_template
│   ├── slide_agent/
│   │   ├── main_api.py       # A2A 服务入口（show_agent=ControllerAgent）
│   │   ├── adk_agent_executor.py
│   │   ├── a2a_client.py
│   │   └── slide_agent/
│   │       ├── agent.py      # WritingSystemAgent（SequentialAgent）
│   │       ├── utils.py      # parse_markdown_to_slides
│   │       ├── config.py     # PPT_WRITER/CHECKER 模型配置
│   │       ├── create_model.py
│   │       └── sub_agents/ppt_writer/
│   │           ├── agent.py  # Writer/Checker/Controller + LoopAgent
│   │           ├── prompt.py # 各页面类型 Prompt + prompt_mapper
│   │           ├── tools.py  # SearchImage/DocumentSearch/KnowledgeBaseSearch
│   │           ├── utils.py  # validate_slide / only_json
│   │           └── weixin_search.py
│   ├── personaldb/
│   │   ├── main.py           # /search、/upload、/files 接口
│   │   ├── embedding_utils.py # EmbeddingModel + ChromaDB + 缓存装饰器
│   │   ├── core/
│   │   │   ├── document_processor.py
│   │   │   ├── markitdown_converter.py
│   │   │   ├── magic_pdf_converter.py
│   │   │   ├── file_cache_manager.py
│   │   │   ├── models.py
│   │   │   └── chunkers/      # base/semantic/recursive/paragraph/hybrid/fast
│   │   └── utils/             # file_handler/logger/validators
│   └── mock_api/
│       ├── mock_main.py
│       └── template/          # 与 main_api/template 相同结构
└── frontend/
    ├── package.json
    ├── vite.config.ts        # 代理 /api → 127.0.0.1:6800
    └── src/
        ├── main.ts / App.vue / router/index.ts
        ├── views/            # Outline / APP(模板选择) / Editor / Screen / Mobile
        ├── hooks/useAIPPT.ts # 模板匹配 + 内容填充引擎
        ├── services/index.ts # API 封装
        ├── store/            # main/slides/screen/snapshot/keyboard
        ├── types/            # AIPPT.ts / slides.ts / ...
        ├── components/       # 基础组件 + 编辑器组件
        ├── configs/          # 主题/字体/图表/形状等
        └── utils/            # htmlParser/prosemirror/clipboard 等
```

------

## 3. 复现顺序（阶段划分）

| 阶段 | 内容                         | 可验证里程碑                                   |
| ---- | ---------------------------- | ---------------------------------------------- |
| 一   | 骨架 + 依赖 + 统一 .env      | 环境就绪，服务目录可运行空 FastAPI              |
| 二   | 知识库服务 personaldb        | 文件上传→向量化→检索通过                        |
| 三   | 大纲生成服务 simpleOutline   | 输入主题流式返回 Markdown 大纲                 |
| 四   | 内容生成服务 slide_agent     | 大纲→逐页 JSON 生成 + 校验通过                 |
| 五   | 主 API 服务 main_api         | /tools/aippt_outline、/tools/aippt 可调用      |
| 六   | 前端 frontend                | 端到端"录入→大纲→模板→生成"打通                |
| 七   | 快速体验 mock_api（可选）    | 无 LLM Key 也能跑通前端                        |
| 八   | 一键启动 + 部署 + 文档       | start.py 一键启动全部服务                      |

------

## 4. 阶段一：项目骨架与环境

```bash
# 1. 建立目录结构（见 2.3）
mkdir -p backend/{main_api,simpleOutline,slide_agent/slide_agent/sub_agents/ppt_writer,personaldb/core/chunkers,personaldb/utils,mock_api}
mkdir -p frontend/src

# 2. 创建统一配置
cp env_template.txt .env          # 再按第 12 节填写真实 Key

# 3. 后端顶层依赖 backend/requirements.txt
```

**backend/requirements.txt（关键依赖，复现时参考）：**

```txt
fastapi
uvicorn
google-genai
google-adk==1.5.0
httpx
a2a-sdk==0.2.10
litellm
python-dotenv
fastmcp==2.2.5
asyncclick
pytest
click
BeautifulSoup4
lxml
python-multipart
openai
chromadb
markitdown[all]>=0.1.2
```

```bash
pip install -r backend/requirements.txt
```

> ⚠️ 版本敏感性：`google-adk`、`a2a-sdk` 的接口在不同版本间有差异（如 `google.adk.agents.llm_agent.LlmAgent`、`a2a.client.A2AClient`），建议优先对齐参考项目的锁定版本。

------

## 5. 阶段二：知识库服务 personaldb（端口 9100）

### 5.1 要实现的文件与职责

| 文件                            | 职责                                                        |
| ------------------------------- | ----------------------------------------------------------- |
| `main.py`                       | FastAPI：`POST /search`、`POST /upload/`、`POST /vectorize/text`、`GET /files/{user_id}` |
| `embedding_utils.py`            | `EmbeddingModel`（多 Provider 向量化）+ `ChromaDB`（存储/检索/删除/列文件）+ `cache_decorator` |
| `core/document_processor.py`    | 文件类型映射、编码检测、文本提取、分块策略选择               |
| `core/markitdown_converter.py`  | MarkItDown 转换（PDF/Word/PPT/图片/音频…）                  |
| `core/magic_pdf_converter.py`   | MinerU 高精度 PDF 解析（可选，`USE_MINERU=true` 时启用）     |
| `core/chunkers/*.py`            | base/semantic/recursive/paragraph/hybrid/fast 分块器         |
| `core/file_cache_manager.py`    | 按 MD5 缓存文件解析结果                                      |
| `core/models.py`                | DocumentInfo、ChunkStrategy 等数据模型                      |
| `utils/*.py`                    | 文件处理、日志、参数校验                                    |

### 5.2 关键实现要点

1. **Embedding 多 Provider 抽象**（`EmbeddingModel`）：支持 `aliyun / doubao / vllm / xinference / ollama`，统一返回 `{"data":[{"embedding":[...]}]}`。
2. **ChromaDB 隔离**：`collection = f"user_{user_id}"`，`metadata` 含 `file_id/user_id/file_name/folder_id/file_type/url`，`id = f"{file_id}_{chunk_index}"`，`hnsw:space=cosine`。
3. **分块**：默认 `FastChunker(max_tokens=1200)`，重叠 200。
4. **解析流程**：文件/URL → 下载/保存临时目录 → MarkItDown（或 MinerU）转 Markdown → 分块 → 向量化 → 入库。
5. **互斥校验**：`file` 与 `url` 二选一。

### 5.3 配置（`personaldb/env_template` 或统一 `.env`）

```bash
EMBEDDING_PROVIDER=aliyun        # aliyun/doubao/vllm/xinference/ollama
EMBEDDING_MODEL=text-embedding-v2
ALI_API_KEY=sk-xxx               # 与 EMBEDDING_PROVIDER 对应的 Key
USE_MINERU=false                 # 是否用 MinerU 解析 PDF（需 GPU）
```

### 5.4 启动与验证

```bash
cd backend/personaldb
python main.py                    # 监听 127.0.0.1:9100

# 验证：上传一个文本文件并检索
curl -F "userId=1" -F "fileId=100" -F "file=@test.md" http://127.0.0.1:9100/upload/
curl -X POST http://127.0.0.1:9100/search -H "Content-Type: application/json" \
     -d '{"userId":1,"query":"测试查询","topk":3}'
curl http://127.0.0.1:9100/files/1
```

------

## 6. 阶段三：大纲生成服务 simpleOutline（端口 10001）

### 6.1 要实现的文件与职责

| 文件                    | 职责                                                        |
| ----------------------- | ----------------------------------------------------------- |
| `main_api.py`           | A2A 服务入口（Starlette + A2AStarletteApplication + Runner） |
| `agent.py`              | `OutlineAgent`（LlmAgent），`tools=[DocumentSearch]`，动态指令 |
| `prompt.py`             | `OUTLINE_INSTRUCTION_WITH_SEARCH` / `NO_SEARCH`，`USER_INPUT_NUMBER=1000` |
| `tools.py`              | `DocumentSearch`（异步工具，调微信搜索，默认返回前 3 篇）     |
| `weixin_search.py`      | `sogou_weixin_search` / `get_real_url` / `get_article_content` |
| `create_model.py`       | LiteLLM 模型工厂（Provider 分支）                            |
| `adk_agent_executor.py` | `ADKAgentExecutor`（Runner 封装）                            |
| `a2a_client.py`         | 本地测试客户端                                              |

### 6.2 关键实现要点

1. **动态 Prompt 切换**：输入长度 ≤ 1000 → 带搜索 Prompt（联网扩充）；> 1000 → 不带搜索 Prompt（仅依据用户内容）。
2. **大纲格式约束**：`# 标题 → ## 一级(5个) → ### 二级(3-4个) → - 要点(3-5条)`。
3. **A2A 服务**：`AgentCard` 声明 `capabilities=AgentCapabilities(streaming=OUTLINE_STREAMING)`；`RunConfig(streaming_mode=SSE, max_llm_calls=500)`。
4. **工具回调**：`after_tool_callback` 把搜到的文章写入 `metadata["tool_document_ids"]`。

### 6.3 配置（`.env`）

```bash
MODEL_PROVIDER=ali              # google/claude/openai/deepseek/ali/silicon/modelscope/doubao/glm/vllm/ollama/local
LLM_MODEL=qwen-turbo-latest
ALI_API_KEY=sk-xxx              # 对应 Provider 的 Key
OUTLINE_STREAMING=true
```

### 6.4 启动与验证

```bash
cd backend/simpleOutline
python main_api.py               # 监听 10001

# 验证（测试客户端）
python a2a_client.py
```

------

## 7. 阶段四：内容生成服务 slide_agent（端口 10011）

### 7.1 要实现的文件与职责

| 文件                                        | 职责                                                          |
| ------------------------------------------- | ------------------------------------------------------------- |
| `main_api.py`                               | A2A 服务入口，`show_agent=["ControllerAgent"]`                |
| `slide_agent/agent.py`                      | `WritingSystemAgent`（SequentialAgent），`before_agent_callback` 解析大纲 |
| `slide_agent/utils.py`                      | `parse_markdown_to_slides`（Markdown→Slide Schema）           |
| `slide_agent/config.py`                     | `PPT_WRITER_AGENT_CONFIG` / `PPT_CHECKER_AGENT_CONFIG`        |
| `slide_agent/create_model.py`               | LiteLLM 模型工厂（同大纲）                                    |
| `sub_agents/ppt_writer/agent.py`            | `PPTWriterSubAgent` + `CheckerAgent` + `ControllerAgent` + `LoopAgent` |
| `sub_agents/ppt_writer/prompt.py`           | 前缀 Prompt + 各页面类型 Prompt + `prompt_mapper`              |
| `sub_agents/ppt_writer/tools.py`            | `SearchImage` / `DocumentSearch` / `KnowledgeBaseSearch`      |
| `sub_agents/ppt_writer/utils.py`            | `validate_slide` / `only_json`（JSON 校验）                   |
| `sub_agents/ppt_writer/weixin_search.py`    | 微信搜索（同大纲）                                            |

### 7.2 关键实现要点

1. **大纲解析**：`# `→cover、`## `→contents 项 + transition、`### `→content、`- `→items，末尾 `end`。
2. **多智能体循环**（核心）：
   ```
   LoopAgent(max_iterations=200)
     ├─ PPTWriterSubAgent  (LlmAgent, tools=[KnowledgeBaseSearch, SearchImage])
     ├─ CheckerAgent       (规则校验 JSON，不调 LLM)
     └─ ControllerAgent    (通过→推进页码；失败→重试≤3次→跳过；末页→escalate 终止)
   ```
3. **JSON 校验**：截取首个 `{` 到末个 `}` 尝试 `json.loads`，再 `validate_slide(data, schema)` 对比必填字段。
4. **页面类型 Prompt**：cover/contents/transition/content/end 各有专属 Prompt；`USE_CHART=true` 时 content 支持生成图表项。
5. **图表结构**：`{kind:"chart", chartType, labels[4-8], series[1-2], options}`。
6. **内容流式注意**：参考项目内容生成 `CONTENT_STREAMING=false`（LLM 非流式，避免 JSON 粘连）；Agent 级别仍流式返回（SSE）。

### 7.3 配置（`.env`）

```bash
PPT_WRITER_PROVIDER=ali
PPT_WRITER_MODEL=qwen-turbo-latest
PPT_CHECKER_PROVIDER=ali
PPT_CHECKER_MODEL=qwen-turbo-latest
PERSONAL_DB=http://127.0.0.1:9100    # KnowledgeBaseSearch 依赖
PEXELS_API_KEY=xxx                    # 配图搜索（可选，缺省用内置图）
USE_CHART=True
CONTENT_STREAMING=false
```

### 7.4 启动与验证

```bash
cd backend/slide_agent
python main_api.py               # 监听 10011

# 验证（测试客户端，内置示例大纲）
python a2a_client.py
```

------

## 8. 阶段五：主 API 服务 main_api（端口 6800）

### 8.1 要实现的文件与职责

| 文件                 | 职责                                                          |
| -------------------- | ------------------------------------------------------------- |
| `main.py`            | FastAPI 网关（见 8.2 接口表）                                 |
| `outline_client.py`  | `A2AOutlineClientWrapper`（A2A 客户端，流式）                 |
| `content_client.py`  | `A2AContentClientWrapper`（流式 + `process_chart_part_text` 拆包） |
| `template/`          | 模板 JSON（template_1..4.json）+ 封面 jpg + 内置 Pexels 图片  |

### 8.2 需实现的接口

| 方法 | 路径                              | 说明                                          |
| ---- | --------------------------------- | --------------------------------------------- |
| POST | `/tools/aippt_outline`            | 流式返回大纲（`text/plain`）                  |
| POST | `/tools/aippt_outline_from_file`  | 上传文件 → personaldb 转 Markdown → 生成大纲   |
| POST | `/tools/aippt`                    | SSE 流式返回逐页 JSON，末尾 `data: [DONE]`     |
| POST | `/tools/aippt_by_id`              | 按文件 id 生成（走知识库检索）                 |
| GET  | `/templates`                      | 返回模板列表（name/id/cover）                 |
| GET  | `/data/{filename}`                | 静态模板/图片文件                              |
| GET  | `/files/{user_id}`                | 转发 personaldb 列出文件                       |
| GET  | `/proxy`                          | 透明代理外链图片（解决前端跨域）              |
| GET  | `/healthz`                        | 健康检查 `{"ok":true}`                        |

### 8.3 关键实现要点

1. **统一配置加载**：优先读取项目根目录 `.env`（`project_root/.env`），否则 `dotenv.load_dotenv()`。
2. **A2A 客户端**：先 `setup()` 获取 AgentCard，再 `send_message_streaming`，解析 `status-update / artifact-update` 分块。
3. **内容 SSE**：每条事件 `data: {payload}\n\n`；长连接每 10s 发 `: keep-alive` 心跳。
4. **图表拆包**：`content` 类型的 items 里含 `kind=chart/image` 时拆成多条独立 slide 输出。
5. **CORS**：`allow_origins=['*']`。

### 8.4 配置（`main_api/env_template` 或统一 `.env`）

```bash
OUTLINE_API=http://127.0.0.1:10001
CONTENT_API=http://127.0.0.1:10011
PERSONAL_DB=http://127.0.0.1:9100
```

> ⚠️ 坑：参考项目 `main_api/env_template` 里写的是 `PERSONENAL_DB`（拼写错误），但 `main.py` 读取的是 `PERSONAL_DB`。复现时统一使用 `PERSONAL_DB`，并优先在根目录 `.env` 配置。

### 8.5 启动与验证

```bash
cd backend/main_api
python main.py                   # 监听 6800

# 验证
curl http://127.0.0.1:6800/healthz
curl http://127.0.0.1:6800/templates
```

------

## 9. 阶段六：前端 frontend（端口 5173）

### 9.1 技术栈与基础

- 基于 **PPTist**（Vue3 + Vite + TypeScript）二次开发，前端依赖 `package.json` 见参考项目。
- 关键改动集中在：`views/Outline`、`views/APP`、`views/PPT`、`hooks/useAIPPT.ts`、`services/index.ts`、`types/AIPPT.ts`、`store/`。

### 9.2 核心实现要点

1. **API 封装**（`services/index.ts`）：`AIPPT_Outline` / `AIPPT_Content` / `AIPPT_Outline_From_File` / `AIPPTByID` / `getTemplates`，均走 `/api` 前缀。
2. **Vite 代理**（`vite.config.ts`）：`/api → http://127.0.0.1:6800`，`rewrite` 去掉 `/api` 前缀。
3. **模板匹配引擎**（`hooks/useAIPPT.ts` 的 `AIPPTGenerator`）：
   - 按 `type`（cover/contents/transition/content/reference/end）分类模板
   - 按元素数量 + 图片/图表槽位 `getUseableTemplates` 选模板
   - `getNewTextElement` 自适应字号、`getNewChartElement` 填图表、`getNewImgElement` 填图
   - 内容项过多自动分页（5-6 项拆 2 页等）
4. **SSE 流式解析**：`reader.read()` 逐行 `JSON.parse`，`data.type==='status'` 显示状态，否则逐页 `addSlide`。
5. **类型定义**（`types/AIPPT.ts`）：对应 Slide Schema 与图表项结构（见 SRS 6.1 节）。

### 9.3 安装与启动

```bash
cd frontend
npm install
npm run dev                      # 监听 127.0.0.1:5173
```

------

## 10. 阶段七：快速体验 mock_api（可选，无 LLM Key）

- `mock_api/mock_main.py` 提供模拟返回，`template/` 与 `main_api/template` 结构相同。
- 用途：尚未配置 LLM/Embedding Key 时，先跑通前端 UI 与模板渲染链路。

```bash
# 启动前端
cd frontend && npm install && npm run dev
# 启动模拟后端
cd backend/mock_api && python mock_main.py
```

------

## 11. 阶段八：一键启动与部署

### 11.1 一键启动（推荐）

```bash
# 1. 配置根目录 .env（从 env_template.txt 复制）
cp env_template.txt .env
# 编辑 .env，填入 API Key

# 2. 一键启动（自动装依赖、起 4 个后端服务 + 前端）
python start.py
```

- 前端：`http://127.0.0.1:5173`，主 API：`6800`，大纲：`10001`，内容：`10011`，知识库：`9100`。
- 日志：`logs/*.log`，`Ctrl+C` 优雅停止。

### 11.2 手动分开启动（调试用）

```bash
# 后端一键启动（自动装依赖、复制 env、起 4 个服务）
cd backend && python start_backend.py

# 或逐个启动（按顺序）
cd backend/personaldb   && python main.py        # 9100
cd backend/simpleOutline && python main_api.py    # 10001
cd backend/slide_agent   && python main_api.py    # 10011
cd backend/main_api      && python main.py        # 6800

# 前端
cd frontend && npm run dev                        # 5173
```

### 11.3 Docker（可选）

```bash
# 先按手动方式为每个服务配置 .env，再：
docker compose up
```

------

## 12. 关键配置清单（.env 汇总）

> 统一放在项目根目录 `.env`，各服务启动时会读取。

```bash
# ===== 大纲生成模型 =====
MODEL_PROVIDER=ali
LLM_MODEL=qwen-turbo-latest

# ===== 内容生成模型（撰写/校对可不同） =====
PPT_WRITER_PROVIDER=ali
PPT_WRITER_MODEL=qwen-turbo-latest
PPT_CHECKER_PROVIDER=ali
PPT_CHECKER_MODEL=qwen-turbo-latest

# ===== 向量嵌入 =====
EMBEDDING_PROVIDER=aliyun        # aliyun/doubao/vllm/xinference/ollama
EMBEDDING_MODEL=text-embedding-v2

# ===== 各供应商 API Key（按需填写） =====
GOOGLE_API_KEY=xxx
OPENAI_API_KEY=xxx
CLAUDE_API_KEY=xxx
DEEPSEEK_API_KEY=xxx
ALI_API_KEY=sk-xxx
DOUBAO_API_KEY=xxx
SILICON_API_KEY=xxx
MODELSCOPE_API_KEY=xxx
GLM_API_KEY=xxx

# ===== 本地模型（可选） =====
OLLAMA_API_URL=http://127.0.0.1:11434/v1
VLLM_API_URL=http://127.0.0.1:8000/v1

# ===== 配图 =====
PEXELS_API_KEY=xxx               # 可选，缺省用内置图片池

# ===== 内部服务地址 =====
OUTLINE_API=http://127.0.0.1:10001
CONTENT_API=http://127.0.0.1:10011
PERSONAL_DB=http://127.0.0.1:9100

# ===== 开关 =====
USE_CHART=True                   # 图表生成
USE_MINERU=false                 # MinerU PDF 解析
OUTLINE_STREAMING=true
CONTENT_STREAMING=false          # 内容 LLM 非流式，避免 JSON 粘连

# ===== 服务端口（可选覆盖） =====
MAIN_API_PORT=6800
OUTLINE_API_PORT=10001
CONTENT_API_PORT=10011
PERSONALDB_PORT=9100
FRONTEND_PORT=5173
```

------

## 13. 启动顺序总结

```
① personaldb   (9100)  —— 知识库，供 slide_agent / main_api 调用
② simpleOutline(10001) —— 大纲 Agent
③ slide_agent  (10011) —— 内容 Agent（依赖 personaldb）
④ main_api     (6800)  —— 网关（依赖 ②③ 和 personaldb）
⑤ frontend     (5173)  —— 依赖 main_api
```

> 一键脚本 `start.py` / `start_backend.py` 已按此编排并含端口占用检测、日志管理。

------

## 14. 端到端验证清单

复现完成后，按以下清单逐项验证：

| # | 验证项                                  | 操作 / 预期结果                                              |
| - | --------------------------------------- | ------------------------------------------------------------ |
| 1 | 各服务健康检查                          | `curl http://127.0.0.1:6800/healthz` 返回 `{"ok":true}`      |
| 2 | 模板列表                                | `curl http://127.0.0.1:6800/templates` 返回模板数组          |
| 3 | 大纲生成                                | 前端输入主题 → 流式出现 Markdown 大纲                        |
| 4 | 大纲编辑                                | 生成后大纲树可编辑，右键可增删节点                           |
| 5 | 模板选择                                | 前端选择一套模板（封面图正确展示）                            |
| 6 | 逐页内容生成                            | 点击"生成PPT" → 逐页 JSON 返回 → 编辑器逐页渲染              |
| 7 | 图表生成                                | 主题含趋势/对比时，内容页出现图表（USE_CHART=True）          |
| 8 | 知识库生成                              | 上传文档 → "根据上传文件生成PPT" → 内容基于文档生成           |
| 9 | 编辑与导出                              | 编辑器可增删元素 → 导出 PPTX/PDF/图片/JSON 成功              |
| 10 | 放映                                    | 全屏演示、翻页正常                                           |

**冒烟测试命令：**

```bash
# 大纲（应流式返回 Markdown）
curl -X POST http://127.0.0.1:6800/tools/aippt_outline \
  -H "Content-Type: application/json" \
  -d '{"content":"电动汽车发展","language":"中文","model":"qwen-turbo-latest","stream":true}'

# 内容（SSE，应逐页返回 JSON 并以 [DONE] 结束）
curl -N -X POST http://127.0.0.1:6800/tools/aippt \
  -H "Content-Type: application/json" -H "Accept: text/event-stream" \
  -d '{"content":"# 标题\n## 章节\n### 小节\n- 要点","language":"zh","generateFromWebSearch":false}'
```

------

## 15. 常见问题与排查

| 现象                       | 原因 / 排查                                        |
| -------------------------- | -------------------------------------------------- |
| 主 API 无法连接大纲/内容服务 | 检查 `OUTLINE_API`/`CONTENT_API` 与端口、服务是否已启动 |
| 知识库搜索报错             | 检查 `PERSONAL_DB` 是否配置正确（注意拼写 `PERSONAL_DB` 非 `PERSONENAL_DB`） |
| `ALI_API_KEY not set`      | Embedding 与 LLM 都依赖对应 Key，未填写导致          |
| 模型不支持工具调用          | 大纲/内容 Agent 需要支持 function-calling 的模型     |
| 内容生成 JSON 粘连/解析失败 | 保持 `CONTENT_STREAMING=false`，LLM 非流式           |
| 端口被占用                 | 启动脚本会自动检测并询问清理，或手动 `kill`           |
| 前端代理 404               | 确认 `vite.config.ts` 的 `/api → 6800` 代理与后端已启动 |
| MinerU 解析过慢            | 默认 `USE_MINERU=false` 走 MarkItDown；MinerU 需 GPU |

------

## 16. 交付物清单

| 文件                              | 说明                              |
| --------------------------------- | --------------------------------- |
| `AiPPT-SRS.md`                    | 软件需求分析规格说明书（9 章）    |
| `AiPPT-复现实施计划.md`（本文档） | 复现工程路线图                    |
| 复现后的 `TrainPPTAgent/` 工程    | 前端 + 后端 4 服务 + 部署脚本      |

