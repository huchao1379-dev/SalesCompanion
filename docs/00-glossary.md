# 00 · 术语表

统一 SalesCompanion 文档中的关键用语，避免「同名不同义」。

## 产品与体验

| 术语 | 定义 |
| --- | --- |
| **SalesCompanion** | 本仓库 Power Apps Code App 名称；销售侧移动 AI 智能业务伙伴。 |
| **Conversational CRM** | 以对话 / 语音召唤能力，而非菜单填表驱动 CRM 操作。 |
| **Mobile-First** | 设计起点为「单手 · 户外 · ≤30 秒」；超过 3 屏的表单必须由对话承接。 |
| **Voice-First** | 主输入为语音；键盘仅为语音失败时的 fallback。 |
| **Confirm, Don't Configure** | AI 产出草稿，用户只做确认 / 微调 / 拒绝三选一。 |
| **Brief Me** | 「今日播报」屏：单卡承载摘要、要点、metric chip 与加入今日 CTA。 |

## 架构分层

| 术语 | 定义 |
| --- | --- |
| **体验层** | Power Apps Code App（主）+ Teams Copilot + Model Driven 管理后台。 |
| **认知层** | 设备原生语音转写 + AI Builder（Prompt / 抽取 / 分类等）。 |
| **编排层** | Copilot Studio Agents + Generative Orchestration + Agent Flow。 |
| **数据层** | Dataverse（AI 操作面）+ Virtual Tables / Service Bus ↔ SAP。 |
| **治理层** | Entra ID、DLP、Managed Environments、Purview、Key Vault、App Insights。 |

## 数据与集成

| 术语 | 定义 |
| --- | --- |
| **System of Record (SoR)** | 权威业务记录系统；本方案中为 **SAP Commerce CRM**，不替换底座。 |
| **System of Engagement (SoE)** | AI / 移动交互操作面；本方案中为 **Microsoft Dataverse**。 |
| **Virtual Tables (VT)** | Dataverse 虚拟表，直连外部实体（客户 / 活动 / 商机等），避免整库同步。 |
| **草稿三段式** | 写入路径：**草稿 (Draft) → 确认 (Confirmed) → 同步 (Synced to SAP)**。 |
| **事件驱动回写** | 用户 Confirm 后经 Azure Service Bus 异步写入 SAP，UI 展示同步进度。 |
| **幂等键 (Idempotency Key)** | 回写 SAP 时用于去重的业务唯一键，防止重复创建。 |

## Agent 体系

| 术语 | 定义 |
| --- | --- |
| **Orchestrator Agent** | 全局唯一调度者（Generative Orchestration）；理解意图、选 Agent、合成回复。 |
| **Domain Agent** | 与业务概念一一对应的执行单元（如客户拜访、商机评估）；默认不互调。 |
| **Skill / Tool** | 可复用原子能力（SAP Connector、Dataverse CRUD、AI Builder、Flow 等）。 |
| **Generative Orchestration** | Copilot Studio 按意图与 Agent 描述自动分发任务的机制。 |
| **Agent Flow** | 事务性长流程编排（顺序依赖、回滚到 draft）。 |
| **★ Agent** | Phase 1 优先落地的高频 Agent（直接服务一线拜访场景）。 |

## 协同模式

| 术语 | 定义 |
| --- | --- |
| **Fan-out（并行扇出）** | 同时调用多个 Domain Agent，延迟 ≈ max，按 `agent_chain` 渲染。 |
| **Sequential（顺序流水）** | 后序依赖前序输出；任一步失败则回滚到 draft。 |
| **Routing（条件路由）** | 意图模糊时先分类再分发；低置信度触发反问。 |
| **Review-Loop（审阅闭环）** | 写操作先出 draft，经督导 Agent + 用户 Confirm 后才落库。 |

## 消息与会话

| 术语 | 定义 |
| --- | --- |
| **Message Envelope** | 统一消息结构：`{ role, agent_name, content, sources[], confidence, draft? }`。 |
| **Source Citation** | `sources[]` 标注 Dataverse / SAP / 知识库片段，供 UI 渲染可信度。 |
| **Shared Memory** | 会话中间结果写入 `CopilotConversation.context`（如 accountId），下游复用。 |
| **agent_chain** | 本次回复涉及的 Agent 调用顺序，用于 UI 分段展示。 |
| **confidence** | AI 输出置信度；低于阈值应反问或要求人工确认，而非猜测写入。 |

## 交付与治理

| 术语 | 定义 |
| --- | --- |
| **Plan-First** | 用 Power Apps Plan Designer 生成角色、数据模型与技术清单后再编码。 |
| **Vibe Build** | Bootstrap + 一屏一 Prompt 生成原型；性能 / 安全 / SAP 集成走 Pro-Code。 |
| **ALM Promote** | Solution 化、Git 解包、Pipeline 推 Test / UAT / Prod。 |
| **DLP** | Data Loss Prevention；控制连接器边界，防止数据外泄。 |
| **Managed Environments** | 带治理能力的 Power Platform 环境拓扑（Dev / UAT / Prod）。 |

## 缩写速查

| 缩写 | 全称 |
| --- | --- |
| APIM | Azure API Management |
| PCF | Power Apps Component Framework |
| MCP | Model Context Protocol（或提案中的 MCP Server 接入面） |
| NPS | Net Promoter Score |
| RACI | Responsible / Accountable / Consulted / Informed |
| SKU | Stock Keeping Unit（此处指微软产品授权单元） |

## 相关文档

- [01 产品总览](01-product-overview.md)
- [03 Agent 架构](03-agent-architecture.md)
- [06 数据模型](06-data-model.md)
