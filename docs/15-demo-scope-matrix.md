# 15 · Demo 范围矩阵（必做 / 选做 / 不做）

> 权威计划原文：[14 Demo 整体计划](14-demo-plan.md)  
> 建表施工：[13 Dataverse 表字段规格](13-dataverse-table-spec.md)  
> 本文回答：**当前仓库与文档里，哪些现在要做、哪些可缓、哪些明确不做。**

---

## 0. 环境硬限制（Demo 前提）

| 能力 | Demo 结论 |
| --- | --- |
| Copilot Studio / Teams Copilot | **不做** → 自研 Orchestrator |
| AI Builder | **不做** → DeepSeek 结构化输出 |
| LLM | **仅 DeepSeek** |
| Dataverse | **必做** · 唯一真实数据源 |
| Virtual Tables → SAP | **不做真实 VT** → 普通表 + 种子数据临时代替 |
| Service Bus → SAP | **不做** → `syncstatus` 模拟 draft → confirmed → synced |

原方案 6 个月路线、SKU、收益、ALM 全套仍保留在 `docs/01–11` 作**愿景文档**；**当前执行以 Demo 为准**。

---

## 1. 业务场景

| 场景 | 结论 | 说明 |
| --- | --- | --- |
| A · 拜访一句话录入 | **必做** | 语音/文本 → 抽取 → 活动+商机草稿 → Confirm → Dataverse |
| B · 客户信息速览 | **必做** | 「仁济最近怎么样」→ 画像 + 商机摘要 + sources |
| C · 订单/物流查询 | **选做** | 有余力再做；依赖 `crmai_order` / `crmai_shipment` |
| 售后 RAG / 标书 / 考核看板 | **不做** | 原方案 Phase 3+ |
| Brief Me 全量播报 | **不做**（可选简化） | Demo 界面表：可选/跳过 |
| 真实 SAP 回写 | **不做** | `synced` 仅语义占位 |

---

## 2. 界面 / 前端

| 模块 | 结论 | 现状与动作 |
| --- | --- | --- |
| 活动录入 ActivityCapture | **必做** | 已有 UI；需接真实 DeepSeek + Dataverse |
| 对话 CopilotChat（客户速览） | **必做** | 已有 UI；需接 Orchestrator + DV 查询 |
| 首页 Home（简化 KPI） | **必做（简化）** | 已有；KPI 改为 Dataverse 聚合 |
| 商机屏独立页 | **不强制** | Demo：商机并入活动/对话草稿卡即可；现有屏可保留作调试 |
| Brief Me | **可不做** | 已实现可留着演示，不计入 Demo 验收 |
| 任务中心 TasksHub | **选做** | 便于看草稿列表；非验收硬项 |
| 客户画像 AccountInsight | **必做（可并入对话）** | 独立页可选；场景 B 至少对话内可完成 |
| 离线口述队列 | **可不做** | Demo 计划未要求；本地缓存可保留但不建 DV 表 |
| 模拟 SAP 失败开关 | **选做** | 演示用；非计划硬项 |

**交互硬规则（必做）：** 橙麦主路径 · AI 草稿+置信度 · `agent_name` · `draft/confirmed/synced` 可视。

---

## 3. Agent / 编排 / 认知

| 能力 | 结论 |
| --- | --- |
| 自研 Orchestrator（DeepSeek 意图+路由） | **必做** |
| EntityExtract（JSON schema） | **必做** |
| AccountProfile Agent | **必做** |
| ActivityCreate Agent | **必做** |
| OpportunityCreate + 简易督导（重复检测） | **必做** |
| OrderQuery Agent | **选做**（随场景 C） |
| Message Envelope（sources / confidence / draft） | **必做** |
| Copilot Studio Generative Orchestration | **不做** |
| AI Builder Prompt / Form / OCR | **不做** |
| 30+ Domain Agent 全景 | **不做**（愿景见 04；Demo 仅 4～5 个） |
| 当前仓库 Mock Orchestrator | **过渡**：演示可暂用；正式 Demo 验收前换 DeepSeek |

---

## 4. Dataverse 建表

| 表（前缀示例 `crmai_`） | 结论 | 角色 |
| --- | --- | --- |
| `crmai_account` | **必建** | 客户 · 临时代替 VT · 种子数据 |
| `crmai_contact` | **必建** | 联系人 · 关联客户 |
| `crmai_activity` | **必建** | 活动/拜访 · AI 操作面（含 syncstatus） |
| `crmai_opportunity` | **必建** | 商机 · 种子「既有商机」+ AI 草稿行（含 syncstatus） |
| `crmai_aiinvocationlog` | **必建** | 调用审计 / prompt 版本 |
| `crmai_order` | **选建** | 场景 C |
| `crmai_shipment` | **选建** | 场景 C |
| `crmai_conversation`（会话上下文） | **选建** | 多轮 Shared Memory；可先前端本地 |
| 真实 Virtual Tables（`*_vt`） | **不建** | 无 SAP VT；用普通表代替 |
| 独立 `AIMetadata` 大表 | **不建** | Demo：关键字段落在 activity / log 即可 |
| `offlineutterance` | **不建** | Demo 不做多设备离线补传 |
| Service Bus / APIM 相关配置 | **不做** | synced 本地/定时模拟即可 |

详细列定义见 [13](13-dataverse-table-spec.md)。

---

## 5. 后端 / 集成

| 项 | 结论 |
| --- | --- |
| DeepSeek API 客户端 | **必做** |
| Dataverse Web API 仓储（读客户、写草稿） | **必做** |
| 种子数据 3～5 家医院（含仁济 + N17 商机） | **必做** |
| `synced` 状态模拟（无真实 SB） | **必做** |
| 独立业务库（SQLite/Postgres 作 SoR） | **不做** |
| 真实 SAP Connector / VT / Service Bus | **不做** |
| Power Apps Code App 打包上架 | **不强制**（现 Vite SPA 即可演示） |

---

## 6. 文档套件如何使用

| 文档 | Demo 期用法 |
| --- | --- |
| [14](14-demo-plan.md) / **本文 15** | **执行范围权威** |
| [13](13-dataverse-table-spec.md) | **按「Demo 必建」列建表** |
| [12](12-phase1-build-guide.md) | 仓库目录与验收；以 Demo 清单为准 |
| [03](03-agent-architecture.md) / [05](05-ui-screens.md) | 契约与 UI 原则仍有效；组件替换见 14 §3 |
| [01–02][04][07–11] | **愿景 / 生产接轨**；不阻塞 Demo |
| [06](06-data-model.md) | 概念保留；实现以 13+14 的普通表模型为准 |
| [07](07-integration-sap.md) | Demo **不实施**；仅备忘接轨 |

---

## 7. Demo 验收 Checklist（摘自计划）

- [x] 无 Copilot Studio、无 AI Builder 即可跑通（`server/` 自研编排）  
- [x] LLM **仅 DeepSeek**（无 Key 时启发式兜底，不引入其它模型）  
- [x] 业务读写 **仅 Dataverse 语义存储**（内存种子 / 可选 Web API）  
- [x] 客户/商机读路径来自普通表种子（VT 替身）  
- [x] Confirm 后可在 store/API 见到 Activity / Opportunity 状态流转  
- [x] 每条 AI 回复含 `agent_name` / `sources` / `confidence`  
- [x] 文本路径可演示；语音为加分项（Web Speech）  
- [x] 选做：订单/物流查询 · 任务中心 · 会话落库 · SyncFailed 模拟  

---

## 8. 一句话

**现在只打穿：** 拜访录入 + 客户速览（+ 可选订单）· DeepSeek 自研编排 · Dataverse 普通表唯一数据源。  
**现在不做：** Copilot / AI Builder / 真实 VT·SB·SAP / Brief Me 与售后全量 / 生产 ALM 全套。
