# AI 智能助手接入方案（多方案对比）— 后端设计

> **目标读者**：项目决策者 / AI 代码生成助手 / 开发者。本文提供 **4 套可选方案**，供评估后择优实施。
>
> **对应待办**：`待办清单.md` P3 → 高级量化工具 → 智能选股助手（LLM 驱动），并扩展为通用 AI 助手能力
>
> **日期**：2026-04-11

---

## 目录

1. [需求分析](#一需求分析)
2. [模型选型策略](#二模型选型策略)
3. [方案一：轻量多模型网关](#三方案一轻量多模型网关)
4. [方案二：MCP Server + 多模型 Router](#四方案二mcp-server--多模型-router)
5. [方案三：LangChain 编排 + Agent 框架](#五方案三langchain-编排--agent-框架)
6. [方案四：混合方案（推荐）](#六方案四混合方案推荐)
7. [方案对比总表](#七方案对比总表)
8. [MCP Server 设计（通用部分）](#八mcp-server-设计通用部分)
9. [公共基础设施](#九公共基础设施)
10. [落地路径建议](#十落地路径建议)

---

## 一、需求分析

### 1.1 用户场景

| 场景                | 类型 | 精度要求 | 示例                                               |
| ------------------- | ---- | -------- | -------------------------------------------------- |
| 日常闲聊 / 概念解释 | 通用 | 低       | "什么是市盈率？"、"帮我解释一下 MACD 金叉"         |
| 自然语言选股        | 专业 | 高       | "帮我找市值 100 亿以上、ROE 连续 3 年增长的消费股" |
| 技术面 / 基本面分析 | 专业 | 高       | "分析贵州茅台最近的技术形态和财务状况"             |
| 策略构建辅助        | 专业 | 高       | "帮我设计一个动量 + 低波动的量化策略"              |
| 数据查询            | 数据 | 高       | "查一下今天北向资金流入前 10 的股票"               |
| 回测结果解读        | 专业 | 中       | "帮我分析一下这个策略为什么最大回撤这么大"         |
| 报告生成辅助        | 专业 | 中       | "帮我生成贵州茅台的分析摘要"                       |

### 1.2 核心设计目标

1. **多模型路由**：日常问答走性价比模型，专业金融分析走金融专精模型
2. **数据联动**：AI 能访问我们自己的数据库（行情、财务、持仓、回测结果等）
3. **MCP 兼容**：支持 MCP 协议，让外部 AI 客户端（Claude Desktop / VS Code 等）也能调用我们的数据
4. **渐进式**：先跑通核心链路，再逐步增加模型和能力
5. **成本可控**：通过模型分级和缓存降低 token 消耗

### 1.3 现有设施可复用性

| 基础设施     | 现状                        | AI 模块可复用方式                   |
| ------------ | --------------------------- | ----------------------------------- |
| JWT Auth     | 全局守卫 + `@CurrentUser()` | AI 接口直接复用，无需额外鉴权       |
| WebSocket    | Socket.IO `/ws` 网关        | 新增 AI 聊天事件，流式输出          |
| BullMQ       | 回测 / 订阅队列已跑通       | 新建 `ai-chat` 队列处理长耗时请求   |
| Redis        | 全局 `REDIS_CLIENT`         | 聊天上下文缓存 / 模型响应缓存       |
| ConfigModule | `registerAs` 配置模式       | 新增 `ai.config.ts` 管理多模型 Key  |
| Prisma       | User 已有完整关联模式       | 新增 ChatSession / ChatMessage 模型 |

---

## 二、模型选型策略

### 2.1 模型分级

| 级别     | 用途                       | 候选模型                                                                 | 定价参考（输入/输出每百万 token） |
| -------- | -------------------------- | ------------------------------------------------------------------------ | --------------------------------- |
| **经济** | 日常闲聊、概念解释、翻译   | DeepSeek-V3、Qwen2.5-72B（阿里百炼）、GLM-4-Flash（智谱）、GPT-4o-mini   | ¥1-4 / ¥2-8                       |
| **专业** | 金融分析、选股、策略设计   | DeepSeek-R1（推理）、Qwen-Finance（金融微调）、GPT-4o、Claude 3.5 Sonnet | ¥8-60 / ¥16-120                   |
| **推理** | 复杂推理、多步 Agent、代码 | Claude Opus 4.6、GPT-o3、DeepSeek-R1                                     | ¥30-75 / ¥60-150                  |

> **注意**：国内部署优先考虑 DeepSeek / Qwen / GLM 系列（无需翻墙、低延迟、中文优化好）。海外模型作为备选。

### 2.2 金融专精模型

| 模型              | 提供方   | 特色                         | 接入方式        |
| ----------------- | -------- | ---------------------------- | --------------- |
| Qwen-Finance      | 阿里百炼 | 金融行业微调、中文财报理解强 | OpenAI 兼容 API |
| FinGPT            | 开源     | 金融 NLP 专精、情感分析      | 自部署或 API    |
| BloombergGPT 思路 | 自建     | 在自有数据上微调开源模型     | 自部署          |
| 万得 AI           | Wind     | 金融数据 + AI 分析一体       | 商业 API        |

### 2.3 路由策略

```
用户输入 → 意图识别（轻量模型 / 关键词规则）
    │
    ├── 金融专业问题 → 专业模型（DeepSeek-R1 / Qwen-Finance）
    │       │
    │       └── 需要数据？→ MCP Tool Call → 查库 → 拼装上下文 → 专业模型
    │
    ├── 日常通用问题 → 经济模型（DeepSeek-V3 / Qwen2.5）
    │
    └── 复杂推理/Agent → 推理模型（Claude Opus / GPT-o3）
```

---

## 三、方案一：轻量多模型网关

### 3.1 架构概述

最简单直接的方案：后端自建一个多模型 API 网关，前端调一个统一接口，后端根据 intent 路由到不同模型。

```
┌──────────────┐     HTTP/WS     ┌──────────────────────┐      API Call      ┌─────────────┐
│              │ ──────────────→ │   NestJS AI Module   │ ──────────────────→ │ DeepSeek    │
│   前端 Web   │                 │                      │                     │ Qwen        │
│              │ ←────────────── │  ┌─────────────────┐ │ ←────────────────── │ OpenAI      │
│              │   SSE / WS      │  │ Model Router    │ │   Streaming         │ Claude      │
└──────────────┘                 │  │ Intent Classify │ │                     └─────────────┘
                                 │  │ Context Builder │ │
                                 │  └─────────────────┘ │
                                 │         │             │
                                 │    Prisma Query      │
                                 │         ↓             │
                                 │  ┌─────────────────┐ │
                                 │  │   PostgreSQL    │ │
                                 │  └─────────────────┘ │
                                 └──────────────────────┘
```

### 3.2 核心组件

```typescript
// ai.config.ts — 注册多模型配置
export default registerAs('ai', () => ({
  router: {
    defaultTier: process.env.AI_DEFAULT_TIER || 'economy',
    intentClassifyModel: process.env.AI_INTENT_MODEL || 'deepseek-v3',
  },
  models: {
    'deepseek-v3': {
      provider: 'deepseek',
      baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
      apiKey: process.env.DEEPSEEK_API_KEY,
      model: 'deepseek-chat',
      tier: 'economy',
      maxTokens: 4096,
    },
    'deepseek-r1': {
      provider: 'deepseek',
      baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
      apiKey: process.env.DEEPSEEK_API_KEY,
      model: 'deepseek-reasoner',
      tier: 'professional',
      maxTokens: 8192,
    },
    'qwen-finance': {
      provider: 'dashscope',
      baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKey: process.env.DASHSCOPE_API_KEY,
      model: 'qwen-plus',
      tier: 'professional',
      maxTokens: 8192,
    },
    'gpt-4o-mini': {
      provider: 'openai',
      baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      apiKey: process.env.OPENAI_API_KEY,
      model: 'gpt-4o-mini',
      tier: 'economy',
      maxTokens: 4096,
    },
    'claude-sonnet': {
      provider: 'anthropic',
      baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: 'claude-sonnet-4-20250514',
      tier: 'professional',
      maxTokens: 8192,
    },
  },
}))
```

```typescript
// model-router.service.ts — 核心路由逻辑
@Injectable()
export class ModelRouterService {
  /** 根据用户消息意图选择模型 */
  async route(message: string, userPreference?: string): Promise<ModelConfig> {
    // 1. 用户手动指定模型 → 直接使用
    if (userPreference) return this.getModel(userPreference)

    // 2. 关键词快速分类（零成本）
    const quickIntent = this.quickClassify(message)
    if (quickIntent) return this.getModelByTier(quickIntent)

    // 3. 调用轻量模型做意图分类
    const intent = await this.classifyIntent(message)
    return this.getModelByTier(intent)
  }

  private quickClassify(message: string): 'economy' | 'professional' | null {
    const financeKeywords = [
      '选股',
      '策略',
      'ROE',
      '筛选',
      '回测',
      '因子',
      '持仓',
      '财务',
      '基本面',
      '技术面',
      '均线',
      'MACD',
      '北向资金',
      '行业轮动',
    ]
    if (financeKeywords.some((kw) => message.includes(kw))) return 'professional'
    return null // 需要进一步分类
  }
}
```

### 3.3 优缺点

| 维度       | 评价                                                          |
| ---------- | ------------------------------------------------------------- |
| **优点**   | 实现最简单、依赖最少、完全自主可控、前端接口统一              |
| **缺点**   | 数据查询能力需自己写硬编码工具函数、不支持外部 MCP 客户端调用 |
| **复杂度** | ⭐⭐（低）                                                    |
| **扩展性** | 中等 — 新增模型容易，但新增数据工具需手动编码                 |

---

## 四、方案二：MCP Server + 多模型 Router

### 4.1 架构概述

在方案一的基础上，将数据访问层抽象为 **MCP Server**。NestJS 后端同时扮演两个角色：

- **AI 聊天后端**（对前端提供 HTTP/WS 接口）
- **MCP Server**（对 AI 模型 / 外部 MCP 客户端暴露数据工具）

```
┌──────────────┐                  ┌──────────────────────────────────────┐
│   前端 Web   │ ── HTTP/WS ───→ │          NestJS Application          │
└──────────────┘                  │                                      │
                                  │  ┌─────────────┐  ┌──────────────┐  │
┌──────────────┐                  │  │  AI Module   │  │  MCP Server  │  │
│ Claude       │                  │  │  (Chat API)  │  │  (Streamable │  │
│ Desktop      │ ── MCP ────────→ │  │              │  │   HTTP)      │  │
│ / VS Code    │                  │  │  Model Router│──│              │  │
└──────────────┘                  │  │              │  │  Tools:      │  │
                                  │  └──────────────┘  │  - query_stock│  │
┌──────────────┐                  │         │          │  - screen     │  │
│ ChatGPT      │                  │    Prisma Query    │  - backtest   │  │
│ (MCP 支持)   │ ── MCP ────────→ │         ↓          │  - portfolio  │  │
└──────────────┘                  │  ┌─────────────┐   │  - financials │  │
                                  │  │ PostgreSQL  │   │  - market     │  │
                                  │  └─────────────┘   └──────────────┘  │
                                  └──────────────────────────────────────┘
```

### 4.2 MCP Server 集成方式

**使用 `@modelcontextprotocol/sdk` 的 TypeScript SDK**，在 NestJS 中挂载为独立模块：

```typescript
// mcp-server.module.ts
@Module({
  providers: [McpServerService, McpToolRegistry],
  exports: [McpServerService],
})
export class McpServerModule {}

// mcp-server.service.ts
@Injectable()
export class McpServerService implements OnModuleInit {
  private server: McpServer

  constructor(
    private readonly toolRegistry: McpToolRegistry,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
    this.server = new McpServer({
      name: 'quant-research-server',
      version: '1.0.0',
    })

    // 注册所有工具
    this.toolRegistry.registerAll(this.server)

    // 挂载 Streamable HTTP transport
    // 在 NestJS HTTP server 上注册 /mcp 路由
  }
}
```

### 4.3 AI 模块调用 MCP Tools

当 AI 模块需要查询数据时，**内部直接调用 MCP Tool 的实现函数**（不走网络），避免自身调自身的网络开销：

```typescript
// ai-chat.service.ts
@Injectable()
export class AiChatService {
  constructor(
    private readonly modelRouter: ModelRouterService,
    private readonly mcpToolRegistry: McpToolRegistry,
    private readonly llmClient: LlmClientService,
  ) {}

  async chat(userId: string, sessionId: string, message: string) {
    const model = await this.modelRouter.route(message)

    // 1. 构建系统提示词（包含可用工具描述）
    const tools = this.mcpToolRegistry.getToolDefinitions()
    const systemPrompt = this.buildSystemPrompt(tools)

    // 2. 调用 LLM（支持 function calling / tool use）
    const response = await this.llmClient.chatWithTools(model, systemPrompt, message, tools)

    // 3. 如果 LLM 请求调用工具 → 本地执行 → 将结果喂回 LLM
    if (response.toolCalls) {
      const toolResults = await this.executeTools(response.toolCalls)
      return this.llmClient.continueWithToolResults(model, response, toolResults)
    }

    return response
  }

  private async executeTools(toolCalls: ToolCall[]) {
    return Promise.all(toolCalls.map((call) => this.mcpToolRegistry.executeTool(call.name, call.arguments)))
  }
}
```

### 4.4 优缺点

| 维度       | 评价                                                                               |
| ---------- | ---------------------------------------------------------------------------------- |
| **优点**   | 数据工具定义一次、多处复用（前端 AI + Claude Desktop + ChatGPT）；标准协议、生态广 |
| **缺点**   | MCP SDK 引入额外复杂度；Streamable HTTP transport 需要额外路由和认证               |
| **复杂度** | ⭐⭐⭐（中）                                                                       |
| **扩展性** | 高 — 新增工具只需注册到 MCP registry，所有客户端自动可见                           |

---

## 五、方案三：LangChain 编排 + Agent 框架

### 5.1 架构概述

使用 LangChain.js（或 Vercel AI SDK）作为 AI 编排层，利用其 Agent、Chain、Memory 等高级抽象来构建复杂的多步工作流。

```
┌──────────────┐     HTTP/WS     ┌──────────────────────────────────────────┐
│   前端 Web   │ ──────────────→ │            NestJS Application            │
└──────────────┘                 │                                          │
                                 │  ┌────────────────────────────────────┐  │
                                 │  │        LangChain.js / AI SDK       │  │
                                 │  │                                    │  │
                                 │  │  ┌──────────┐  ┌───────────────┐  │  │
                                 │  │  │  Agent    │  │  Tool Chain   │  │  │
                                 │  │  │  Router   │  │  - StockTool  │  │  │
                                 │  │  │          │  │  - ScreenTool │  │  │
                                 │  │  │  Memory  │  │  - FinanceTool│  │  │
                                 │  │  │  Manager │  │  - BacktestTool│ │  │
                                 │  │  └──────────┘  └───────────────┘  │  │
                                 │  │          │                │       │  │
                                 │  │     Multi-Model           │       │  │
                                 │  │     Provider              │       │  │
                                 │  └──────────┼────────────────┼──────┘  │
                                 │             │                │         │
                                 │        LLM APIs        Prisma Query   │
                                 │             ↓                ↓         │
                                 │  ┌──────────────┐  ┌──────────────┐   │
                                 │  │ DeepSeek /   │  │  PostgreSQL  │   │
                                 │  │ Qwen / GPT   │  └──────────────┘   │
                                 │  └──────────────┘                     │
                                 └──────────────────────────────────────────┘
```

### 5.2 关键代码结构

```typescript
// 使用 Vercel AI SDK（更轻量，适合 NestJS）
import { generateText, streamText, tool } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'

// 定义工具
const stockQueryTool = tool({
  description: '查询股票行情、技术指标和基本面数据',
  parameters: z.object({
    tsCode: z.string().describe('股票代码，如 000001.SZ'),
    metrics: z.array(z.enum(['price', 'technical', 'financial'])),
  }),
  execute: async ({ tsCode, metrics }) => {
    // 调用 Prisma 查询
  },
})

const screenStockTool = tool({
  description: '根据条件筛选股票',
  parameters: z.object({
    conditions: z.string().describe('筛选条件的自然语言描述'),
  }),
  execute: async ({ conditions }) => {
    // 解析条件 → 调用选股器
  },
})

// Agent 路由
@Injectable()
export class AiAgentService {
  async chat(message: string, history: Message[]) {
    const model = this.selectModel(message)

    const result = await streamText({
      model,
      system: QUANT_SYSTEM_PROMPT,
      messages: history,
      tools: {
        queryStock: stockQueryTool,
        screenStocks: screenStockTool,
        analyzeBacktest: backtestTool,
        queryMarket: marketTool,
        queryPortfolio: portfolioTool,
      },
      maxSteps: 5, // 最多 5 轮 tool call
    })

    return result.toDataStreamResponse()
  }
}
```

### 5.3 优缺点

| 维度       | 评价                                                                           |
| ---------- | ------------------------------------------------------------------------------ |
| **优点**   | Agent 抽象强大、多步推理内置、Memory 管理内置、流式输出开箱即用                |
| **缺点**   | 依赖 AI SDK/LangChain 生态（版本迭代快、破坏性更新多）；不自带 MCP Server 能力 |
| **复杂度** | ⭐⭐⭐（中）                                                                   |
| **扩展性** | 高 — Tool 定义灵活，但限制在自己的应用内                                       |

---

## 六、方案四：混合方案（推荐）

### 6.1 架构概述

**组合方案一 + 方案二 + 方案三的优势**：

- **Vercel AI SDK** 作为 LLM 调用和流式输出层（轻量、类型安全、多模型支持好）
- **自建 Model Router** 做智能路由（不依赖第三方框架的路由逻辑）
- **MCP Server** 独立暴露数据工具（让 Claude Desktop / VS Code / ChatGPT 也能用）
- **MCP Tools 与 AI SDK Tools 共享实现**（工具函数写一份，两处注册）

```
                    ┌───────────────────────────────────────────────────────────────┐
                    │                    NestJS Application                         │
                    │                                                               │
┌──────────┐  HTTP  │  ┌─────────────────────────────────────────────────────────┐  │
│ 前端 Web │ ─────→ │  │                    AI Module                           │  │
│          │  WS    │  │  ┌──────────┐  ┌──────────┐  ┌────────────────────┐   │  │
│          │ ←───── │  │  │ Chat     │  │ Model    │  │ Vercel AI SDK      │   │  │
└──────────┘ Stream │  │  │ Controller│  │ Router   │  │ (streamText/       │   │  │
                    │  │  │ (REST+WS)│  │          │  │  generateText)     │   │  │
                    │  │  └──────────┘  └──────────┘  └────────────────────┘   │  │
                    │  │         │                              │               │  │
                    │  │         │        ┌─────────────────────┘               │  │
                    │  │         │        │  Tool Calls                         │  │
                    │  │         │        ↓                                     │  │
                    │  │  ┌──────────────────────────────┐                      │  │
                    │  │  │    Shared Tool Implementations │                    │  │
                    │  │  │    (query_stock, screen,       │                    │  │
                    │  │  │     backtest, portfolio,        │                    │  │
                    │  │  │     market, financials ...)     │                    │  │
                    │  │  └──────────────┬───────────────┘                      │  │
                    │  └─────────────────┼─────────────────────────────────────┘  │
                    │                    │                                         │
                    │          ┌─────────┴─────────┐                              │
                    │          │  Prisma / Redis    │                              │
                    │          └─────────┬─────────┘                              │
                    │                    │                                         │
┌──────────┐  MCP   │  ┌────────────────┴──────────────────┐                     │
│ Claude   │ ─────→ │  │         MCP Server Module          │                     │
│ Desktop  │        │  │  (Streamable HTTP on /mcp)         │                     │
│ VS Code  │ ←───── │  │  注册相同的 Tool Implementations   │                     │
│ ChatGPT  │        │  └───────────────────────────────────┘                     │
└──────────┘        └───────────────────────────────────────────────────────────────┘
```

### 6.2 模块分层

```
src/apps/ai/
├── ai.module.ts                    # 模块定义
├── ai.controller.ts                # REST 端点 (POST /ai/chat, GET /ai/sessions)
├── ai.gateway.ts                   # WebSocket 网关扩展（流式聊天）
├── config/
│   └── ai.config.ts                # 多模型配置 (registerAs)
├── services/
│   ├── ai-chat.service.ts          # 聊天编排层
│   ├── model-router.service.ts     # 意图识别 + 模型路由
│   ├── llm-client.service.ts       # Vercel AI SDK 封装（统一多模型调用）
│   └── chat-context.service.ts     # 会话上下文管理（Redis 缓存）
├── tools/                          # 共享工具实现（AI SDK + MCP 共用）
│   ├── tool-registry.ts            # 工具注册中心
│   ├── stock-query.tool.ts         # 股票行情 + 技术指标查询
│   ├── stock-screen.tool.ts        # 自然语言 → 选股器条件转换
│   ├── financial-query.tool.ts     # 财务数据查询
│   ├── backtest-query.tool.ts      # 回测结果查询与分析
│   ├── portfolio-query.tool.ts     # 组合持仓查询
│   ├── market-overview.tool.ts     # 市场概览数据
│   └── fund-flow.tool.ts           # 资金面数据（北向 / 行业资金流）
├── dto/
│   ├── chat.dto.ts                 # 聊天请求/响应 DTO
│   └── session.dto.ts              # 会话管理 DTO
└── prompts/
    ├── system-prompts.ts           # 系统提示词模板
    └── intent-classify.ts          # 意图分类提示词

src/apps/mcp/
├── mcp.module.ts                   # MCP Server 模块
├── mcp-server.service.ts           # MCP Server 生命周期管理
├── mcp-auth.guard.ts               # MCP 请求认证（Bearer Token）
└── mcp-transport.controller.ts     # Streamable HTTP 路由 (/mcp)
```

### 6.3 关键实现细节

#### 工具共享机制

```typescript
// tools/tool-registry.ts
export interface QuantTool {
  name: string
  description: string
  parameters: z.ZodSchema
  execute: (args: any, context: ToolContext) => Promise<any>
}

export interface ToolContext {
  userId?: string
  prisma: PrismaService
}

@Injectable()
export class ToolRegistry {
  private tools = new Map<string, QuantTool>()

  register(tool: QuantTool) {
    this.tools.set(tool.name, tool)
  }

  /** 转为 Vercel AI SDK 的 tool 格式 */
  toAiSdkTools(context: ToolContext): Record<string, CoreTool> {
    const result: Record<string, CoreTool> = {}
    for (const [name, t] of this.tools) {
      result[name] = tool({
        description: t.description,
        parameters: t.parameters,
        execute: (args) => t.execute(args, context),
      })
    }
    return result
  }

  /** 转为 MCP Server 的 tool 注册格式 */
  registerToMcpServer(server: McpServer, context: ToolContext) {
    for (const [name, t] of this.tools) {
      server.tool(name, t.description, zodToJsonSchema(t.parameters), async (args) => {
        const result = await t.execute(args, context)
        return { content: [{ type: 'text', text: JSON.stringify(result) }] }
      })
    }
  }
}
```

#### 流式聊天（WebSocket）

```typescript
// ai.gateway.ts — 扩展现有 EventsGateway
@SubscribeMessage('ai_chat')
async handleAiChat(
  @ConnectedSocket() client: Socket,
  @MessageBody() data: { sessionId: string; message: string; model?: string },
) {
  const userId = client.data.userId
  if (!userId) return

  const stream = await this.aiChatService.streamChat(userId, data.sessionId, data.message, data.model)

  for await (const chunk of stream) {
    client.emit('ai_chat_chunk', {
      sessionId: data.sessionId,
      type: chunk.type, // 'text' | 'tool_call' | 'tool_result' | 'done'
      content: chunk.content,
    })
  }

  client.emit('ai_chat_done', { sessionId: data.sessionId })
}
```

### 6.4 优缺点

| 维度       | 评价                                                                         |
| ---------- | ---------------------------------------------------------------------------- |
| **优点**   | 综合最优：模型路由自主可控、MCP 生态兼容、工具实现共享、流式输出、渐进式落地 |
| **缺点**   | 整体工作量最大（但可分阶段实施）                                             |
| **复杂度** | ⭐⭐⭐⭐（中高）                                                             |
| **扩展性** | 最高 — 模型/工具/客户端三个维度均可独立扩展                                  |

---

## 七、方案对比总表

| 维度               | 方案一：轻量网关 | 方案二：MCP Server          | 方案三：LangChain/AI SDK | 方案四：混合（推荐）                             |
| ------------------ | ---------------- | --------------------------- | ------------------------ | ------------------------------------------------ |
| **实现复杂度**     | ⭐⭐ 低          | ⭐⭐⭐ 中                   | ⭐⭐⭐ 中                | ⭐⭐⭐⭐ 中高                                    |
| **多模型路由**     | ✅ 自建          | ✅ 自建                     | ✅ 框架内置              | ✅ 自建 + AI SDK                                 |
| **流式输出**       | 需手写 SSE       | 需手写                      | ✅ 内置                  | ✅ AI SDK 内置                                   |
| **MCP 兼容**       | ❌               | ✅                          | ❌                       | ✅                                               |
| **外部客户端**     | 仅前端           | Claude/VS Code/ChatGPT      | 仅前端                   | 全部                                             |
| **数据访问**       | 硬编码工具函数   | MCP Tools（标准化）         | LangChain Tools          | 共享 Tool（标准化）                              |
| **Agent 多步推理** | 需手写循环       | 需手写                      | ✅ 内置                  | ✅ AI SDK maxSteps                               |
| **会话记忆**       | 需手写 Redis     | 需手写                      | ✅ 框架内置              | 自建 Redis（可控）                               |
| **新增依赖**       | 仅 HTTP client   | `@modelcontextprotocol/sdk` | `ai` + `@ai-sdk/*`       | `ai` + `@ai-sdk/*` + `@modelcontextprotocol/sdk` |
| **分阶段可行性**   | ✅               | ✅                          | ✅                       | ✅（最佳分阶段路径）                             |
| **成本控制**       | 自建缓存 + 路由  | 同左                        | 同左                     | 同左 + 粒度最细                                  |
| **社区生态**       | 无               | MCP 生态快速扩展中          | LangChain 生态成熟       | 兼得 MCP + AI SDK 生态                           |

---

## 八、MCP Server 设计（通用部分）

> 方案二、方案四均需要此模块。以下设计独立于方案选择。

### 8.1 MCP Tools 清单

| Tool 名称                    | 参数                                  | 返回                          | 数据源                      |
| ---------------------------- | ------------------------------------- | ----------------------------- | --------------------------- |
| `query_stock_price`          | tsCode, startDate?, endDate?, period? | OHLCV 前复权行情序列          | Daily + AdjFactor           |
| `query_technical_indicators` | tsCode, period?                       | MA/MACD/RSI/KDJ/BOLL 最新值   | 计算自 Daily                |
| `query_financial_data`       | tsCode, metrics[]                     | ROE/净利润/营收等财务指标     | FinaIndicator + Income      |
| `screen_stocks`              | conditions (JSON)                     | 符合条件的股票列表 + 关键指标 | 选股器逻辑                  |
| `query_market_overview`      | -                                     | 大盘指数/涨跌统计/成交量      | Market 模块                 |
| `query_fund_flow`            | type (northbound/industry/individual) | 资金流向数据                  | MoneyFlow 系列表            |
| `query_portfolio`            | portfolioId                           | 持仓明细/盈亏/行业分布        | Portfolio 模块              |
| `query_backtest_result`      | runId                                 | 绩效指标/净值曲线/交易明细    | Backtest 模块               |
| `query_stock_info`           | tsCode                                | 公司基本信息/行业/上市日期    | StockBasic + Company        |
| `query_heatmap`              | dimension (industry/index/concept)    | 板块涨跌幅热力图数据          | Heatmap 模块                |
| `query_index_weight`         | indexCode                             | 指数成分股及权重              | IndexWeight                 |
| `query_holder_info`          | tsCode                                | 前十大股东/股东户数           | Top10Holders + HolderNumber |

### 8.2 MCP Resources

| Resource URI               | 说明                          |
| -------------------------- | ----------------------------- |
| `quant://stock/{tsCode}`   | 个股综合信息（基本面 + 行情） |
| `quant://portfolio/{id}`   | 组合详情                      |
| `quant://backtest/{runId}` | 回测运行详情                  |
| `quant://market/overview`  | 当日市场概览                  |
| `quant://schema/screener`  | 选股器条件 JSON Schema        |

### 8.3 MCP Prompts

| Prompt 名称        | 用途                                |
| ------------------ | ----------------------------------- |
| `analyze_stock`    | 个股全面分析模板（技术面 + 基本面） |
| `screen_stocks`    | 自然语言选股引导模板                |
| `explain_backtest` | 回测结果解读模板                    |
| `compare_stocks`   | 多股对比分析模板                    |

### 8.4 认证与安全

```typescript
// MCP Server 认证：Bearer Token
// 用户需在系统设置中生成 MCP Access Token（与 JWT 不同，长期有效）

// mcp-auth.guard.ts
@Injectable()
export class McpAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest()
    const authHeader = request.headers['authorization']
    if (!authHeader?.startsWith('Bearer ')) return false
    const token = authHeader.slice(7)
    // 验证 MCP Access Token（存储在 User 表或独立表）
    return this.validateMcpToken(token)
  }
}
```

---

## 九、公共基础设施

### 9.1 Prisma Schema（所有方案共用）

**文件**：`prisma/ai_chat.prisma`

```prisma
/// AI 聊天会话
model ChatSession {
  id          String        @id @default(uuid()) @db.Uuid
  userId      Int           @map("user_id")
  title       String?       @db.VarChar(200)
  /// 当前使用的模型标识
  modelId     String?       @map("model_id") @db.VarChar(100)
  /// 累计消耗 token 数
  totalTokens Int           @default(0) @map("total_tokens")
  createdAt   DateTime      @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt   DateTime      @updatedAt @map("updated_at") @db.Timestamptz()

  user        User          @relation(fields: [userId], references: [id])
  messages    ChatMessage[]

  @@index([userId, updatedAt(sort: Desc)])
  @@map("chat_sessions")
}

/// AI 聊天消息
model ChatMessage {
  id          String      @id @default(uuid()) @db.Uuid
  sessionId   String      @map("session_id") @db.Uuid
  role        ChatRole    @map("role")
  content     String      @db.Text
  /// tool call 的结构化数据
  toolCalls   Json?       @map("tool_calls") @db.JsonB
  toolResults Json?       @map("tool_results") @db.JsonB
  /// 本条消息使用的模型
  modelId     String?     @map("model_id") @db.VarChar(100)
  /// token  用量
  promptTokens    Int?    @map("prompt_tokens")
  completionTokens Int?   @map("completion_tokens")
  /// 耗时（ms）
  latencyMs   Int?        @map("latency_ms")
  createdAt   DateTime    @default(now()) @map("created_at") @db.Timestamptz()

  session     ChatSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId, createdAt])
  @@map("chat_messages")
}

/// MCP 访问令牌
model McpAccessToken {
  id          String    @id @default(uuid()) @db.Uuid
  userId      Int       @map("user_id")
  token       String    @unique @db.VarChar(128)
  name        String    @db.VarChar(100)
  lastUsedAt  DateTime? @map("last_used_at") @db.Timestamptz()
  expiresAt   DateTime? @map("expires_at") @db.Timestamptz()
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz()

  user        User      @relation(fields: [userId], references: [id])

  @@index([token])
  @@index([userId])
  @@map("mcp_access_tokens")
}

enum ChatRole {
  USER
  ASSISTANT
  SYSTEM
  TOOL

  @@map("chat_role")
}
```

### 9.2 环境变量

```env
# ── AI 模型配置 ──────────────────────────────────────────
# DeepSeek（经济 + 专业）
DEEPSEEK_API_KEY=sk-xxx
DEEPSEEK_BASE_URL=https://api.deepseek.com

# 阿里百炼 / Qwen（金融专精）
DASHSCOPE_API_KEY=sk-xxx
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1

# OpenAI（备选）
OPENAI_API_KEY=sk-xxx
OPENAI_BASE_URL=https://api.openai.com/v1

# Anthropic（备选）
ANTHROPIC_API_KEY=sk-xxx

# ── AI 路由配置 ──────────────────────────────────────────
AI_DEFAULT_TIER=economy
AI_INTENT_MODEL=deepseek-v3
AI_MAX_CONTEXT_MESSAGES=20
AI_CACHE_TTL_SECONDS=300
```

### 9.3 依赖安装

```bash
# 方案一（最小）
pnpm add openai   # OpenAI SDK（兼容 DeepSeek / Qwen / 多数国内模型）

# 方案二（+ MCP）
pnpm add openai @modelcontextprotocol/sdk

# 方案三（AI SDK）
pnpm add ai @ai-sdk/openai @ai-sdk/anthropic

# 方案四（混合，推荐）
pnpm add ai @ai-sdk/openai @ai-sdk/anthropic @modelcontextprotocol/sdk
```

### 9.4 Token 用量与成本监控

```typescript
// 每次 AI 调用后记录用量
interface TokenUsageRecord {
  userId: number
  modelId: string
  promptTokens: number
  completionTokens: number
  estimatedCost: number // 按模型定价估算
}

// Prometheus 指标
const aiTokensTotal = new Counter({
  name: 'ai_tokens_total',
  help: 'Total AI tokens consumed',
  labelNames: ['model', 'tier', 'direction'], // direction: prompt | completion
})

const aiRequestDuration = new Histogram({
  name: 'ai_request_duration_seconds',
  help: 'AI request latency',
  labelNames: ['model', 'tier', 'has_tool_call'],
})

const aiRequestErrors = new Counter({
  name: 'ai_request_errors_total',
  help: 'AI request errors',
  labelNames: ['model', 'error_type'],
})
```

---

## 十、落地路径建议

### Phase 1：最小可用（1-2 周）

> 先跑通核心对话能力，验证模型选型

- [ ] 新建 `src/apps/ai/` 模块
- [ ] 实现 `ai.config.ts`（多模型配置）
- [ ] 实现 `llm-client.service.ts`（统一 LLM 调用，先接 DeepSeek-V3 + DeepSeek-R1）
- [ ] 实现 `model-router.service.ts`（关键词快速分类 + 轻量意图识别）
- [ ] 实现 `ai-chat.service.ts`（基础对话，无 tool call）
- [ ] 新增 Prisma 模型（ChatSession + ChatMessage）
- [ ] REST API：`POST /ai/chat`、`GET /ai/sessions`、`GET /ai/sessions/:id/messages`
- [ ] WebSocket 流式输出：`ai_chat` 事件

### Phase 2：数据工具接入（1-2 周）

> 让 AI 能查询自己的数据

- [ ] 实现共享 Tool 注册中心（`ToolRegistry`）
- [ ] 实现 4-6 个核心工具（stock_query / screen / financial / market / portfolio / backtest）
- [ ] 接入 Vercel AI SDK 的 `streamText` + `tools` 能力
- [ ] 支持多步 tool call（`maxSteps: 5`）
- [ ] 前端展示 tool call 过程（"正在查询 xxx..."）

### Phase 3：MCP Server（1 周）

> 让 Claude Desktop / VS Code / ChatGPT 也能用

- [ ] 集成 `@modelcontextprotocol/sdk`
- [ ] 注册 Streamable HTTP transport 在 `/mcp` 路由
- [ ] MCP 认证（Bearer Token + McpAccessToken 表）
- [ ] 将 Phase 2 的工具注册到 MCP Server
- [ ] MCP Resources + Prompts 注册
- [ ] 用户设置页：生成 / 管理 MCP Access Token

### Phase 4：增强（持续迭代）

- [ ] 接入更多模型（Qwen-Finance / Claude / GPT-4o）
- [ ] 智能选股助手：自然语言 → 选股器 JSON 配置自动转换
- [ ] 报告生成：AI 辅助撰写研报摘要（与报告引擎联动）
- [ ] 用量配额：用户级 token 配额与计费
- [ ] 对话分享：生成对话分享链接

---

## 附录：文件变更汇总

| 操作 | 文件路径                                       | 说明                                            |
| ---- | ---------------------------------------------- | ----------------------------------------------- |
| 新增 | `prisma/ai_chat.prisma`                        | ChatSession / ChatMessage / McpAccessToken 模型 |
| 新增 | `src/apps/ai/ai.module.ts`                     | AI 模块定义                                     |
| 新增 | `src/apps/ai/ai.controller.ts`                 | REST 端点                                       |
| 新增 | `src/apps/ai/ai.gateway.ts`                    | WebSocket 事件扩展                              |
| 新增 | `src/apps/ai/config/ai.config.ts`              | 多模型配置                                      |
| 新增 | `src/apps/ai/services/ai-chat.service.ts`      | 聊天编排层                                      |
| 新增 | `src/apps/ai/services/model-router.service.ts` | 模型路由                                        |
| 新增 | `src/apps/ai/services/llm-client.service.ts`   | LLM 统一调用封装                                |
| 新增 | `src/apps/ai/services/chat-context.service.ts` | 会话上下文管理                                  |
| 新增 | `src/apps/ai/tools/tool-registry.ts`           | 共享工具注册中心                                |
| 新增 | `src/apps/ai/tools/*.tool.ts`                  | 8-12 个数据工具实现                             |
| 新增 | `src/apps/ai/dto/*.dto.ts`                     | 请求/响应 DTO                                   |
| 新增 | `src/apps/ai/prompts/*.ts`                     | 系统提示词 + 意图分类提示词                     |
| 新增 | `src/apps/mcp/mcp.module.ts`                   | MCP Server 模块                                 |
| 新增 | `src/apps/mcp/mcp-server.service.ts`           | MCP 生命周期                                    |
| 新增 | `src/apps/mcp/mcp-auth.guard.ts`               | MCP 认证                                        |
| 新增 | `src/apps/mcp/mcp-transport.controller.ts`     | Streamable HTTP 路由                            |
| 修改 | `src/config/index.ts`                          | 新增 ai 配置导出                                |
| 修改 | `src/app.module.ts`                            | 注册 AiModule + McpModule                       |
| 修改 | `prisma/user.prisma`                           | User 增加 chatSessions / mcpTokens 关联         |
| 修改 | `src/websocket/events.gateway.ts`              | 增加 `ai_chat` 事件                             |
| 修改 | `.env.example`                                 | 增加 AI 相关环境变量                            |
| 修改 | `package.json`                                 | 增加 ai / mcp 依赖                              |
