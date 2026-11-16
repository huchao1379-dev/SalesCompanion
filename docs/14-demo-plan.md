# Mindray CRM AI — 小型运行 Demo 整体计划

> 依据：[销售 CRM 移动 AI 智能体方案](https://illusion615.github.io/KnowledgeHub/posts/mindray-crm-ai-proposal/index.html#architecture)  
> 目标：搭一套**可跑通**的小型 Demo，形态对齐原方案架构。  
> 本文刻意忽略：业务挑战、设计哲学、交付方式、实施路线（6 个月）、建议产品配置、方案预期收益。  
>  
> **本仓库执行索引：** [15 范围矩阵（必做/选做/不做）](15-demo-scope-matrix.md) · [13 Dataverse 建表规格](13-dataverse-table-spec.md)

---

### 当前环境约束（硬限制）

| 能力 | 原方案 | 当前可用？ | Demo 做法 |
| --- | --- | --- | --- |
| Copilot Studio / Teams Copilot | 编排核心 | ❌ 不支持 | **自研 Orchestrator** |
| AI Builder（Prompt / Form / 抽取） | 认知层 | ❌ 不支持 | **DeepSeek** 结构化输出替代 |
| LLM | AI Builder / Azure OpenAI 等 | 仅 **DeepSeek** | 编排 + 抽取 + 摘要统一走 DeepSeek |
| Dataverse | AI 操作面 | ✅ 可用 | **唯一真实数据源** |
| Virtual Tables → SAP | 读路径 | ❌ 暂无真实 VT | **Dataverse 普通表临时代替**（种子数据模拟 SAP 实体） |
| Service Bus → SAP 回写 | 写路径 | ❌ 暂无 | 状态字段模拟 `draft → confirmed → synced` |

---

## 1. Demo 定位

| 维度 | 原方案 | 本 Demo |
| --- | --- | --- |
| 形态 | Power Platform 生产级智能业务伙伴 | 可运行的端到端原型（演示 + 验证） |
| 编排 | Copilot Studio Generative Orchestration | **自研轻量 Orchestrator**（DeepSeek Tool Calling / JSON 计划） |
| 认知 | AI Builder Prompt / Form Processing | **DeepSeek**（实体抽取、意图分类、摘要） |
| 数据 | Dataverse + Virtual Tables → SAP | **仅 Dataverse**：业务实体用普通表临时代替 VT；AI 元数据同仓 |
| 入口 | Power Apps Code App + Teams + MDA | **单一 React 移动 Web App**（经 Dataverse Web API / 自定义 API） |
| 范围 | 30+ Agent、五大业务域 | **2～3 个核心场景、4～5 个 Domain Agent** |
| 治理 | Entra / DLP / Purview 全套 | Demo 级：环境内鉴权 + 调用日志表 |

**成功标准（可演示）：**

1. 用户语音（或文本）描述一次拜访 → DeepSeek 抽出客户/联系人/产品/数量等字段。  
2. Orchestrator 调度多个 Agent，生成「活动草稿 + 商机草稿」卡片。  
3. 用户 Confirm 后写入 **Dataverse**，并展示「草稿 → 已确认 → 已同步」状态。  
4. 可用自然语言查询客户画像 / 订单状态，回答带来源与置信度（来源指向 Dataverse 记录）。

---

## 2. 业务场景（Demo 范围）

只做一线销售拜访主链路，对应原方案 Phase 1 ★ 高频场景的**最小闭环**。

### 2.1 场景 A — 拜访一句话录入（主 Demo，必做）

**用户故事：** 拜访结束后，销售语音说一句结果；系统生成活动反馈 + 可选商机草稿；销售确认后写入 Dataverse。

**示例话术：**

> 刚拜访完上海仁济医院张主任，他对监护仪 N17 感兴趣，要 12 台，下周三再约一次定标书细节。

**涉及能力：**

| 步骤 | 业务动作 | Demo 中的 Agent / 能力 |
| --- | --- | --- |
| 1 | 语音/文本输入 | Web Speech API + 文本 fallback |
| 2 | 实体抽取 | EntityExtract（**DeepSeek** JSON schema） |
| 3 | 客户校验 | 客户画像 Agent（查 Dataverse 客户表 + 近期拜访） |
| 4 | 活动草稿 | 活动创建 Agent → Dataverse Activity 草稿行 |
| 5 | 商机草稿 / 重复检测 | 商机创建 Agent + 简易督导规则 |
| 6 | 用户确认 | Confirm / Edit / Discard |
| 7 | 落库与同步态 | Confirm 后写 Dataverse；`synced` 模拟「已回写 SAP」（无真实 SB） |

**协作模式：** 顺序流水（抽取 → 创建）+ 审阅闭环（Confirm 才提交）。

### 2.2 场景 B — 客户信息速览（必做）

**用户故事：** 「仁济医院最近怎么样？」→ 客户画像 + 进行中商机摘要合成回答。

**涉及能力：** 客户画像 Agent、商机评估（只读摘要）、来源引用（Dataverse 记录 ID）。

**协作模式：** 并行扇出（画像 + 商机一并查）。

### 2.3 场景 C — 订单/物流查询（选做，增强演示）

**用户故事：** 「查一下仁济医院上个订单的物流」→ 订单状态 + 预计交付。

**涉及能力：** 订单/物流 Agent，数据来自 Dataverse 临时订单表（模拟原 VT/SAP）。

**协作模式：** 条件路由或并行扇出。

### 2.4 明确不做（本 Demo）

- Teams Copilot / Copilot Studio  
- AI Builder 任意能力  
- 真实 SAP Virtual Tables / Service Bus / APIM 生产链路  
- 售后 RAG、标书、考核看板、Brief Me 全量  
- 完整 Purview / DLP / Managed Environments ALM  

---

## 3. 技术架构（对齐五层；去掉 Copilot + AI Builder）

原方案五区：**体验层 → 认知层 ∥ 编排层 → 数据层**，**治理层横切**。Demo 保持分层，按环境约束替换。

```
┌─────────────────────────────────────────────────────────────┐
│ 体验层 Experience                                            │
│  React Mobile Web（对话 · 看板简页 · 草稿卡片）               │
│  常驻麦克风 · Confirm/Edit/Discard · 同步状态条               │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTPS（Dataverse Web API / 自建 API）
┌──────────────────────────▼──────────────────────────────────┐
│ 编排层 Orchestration（替代 Copilot Studio）                   │
│  Orchestrator（唯一入口，DeepSeek 意图 + 工具调度）            │
│  Domain Agents：抽取 / 客户画像 / 活动 / 商机 / 订单·物流      │
│  统一消息契约 Message Envelope                                │
└───────────────┬──────────────────────────┬──────────────────┘
                │                          │
┌───────────────▼──────────────┐  ┌────────▼──────────────────┐
│ 认知层 Cognitive             │  │ Skill / Tool Layer         │
│  Web Speech API（设备原生）   │  │  Dataverse Tools           │
│  DeepSeek（替代 AI Builder）  │  │  · searchAccount           │
│  · 实体抽取 · 意图分类        │  │  · createActivityDraft     │
│  · 摘要合成 · Tool Calling    │  │  · createOpportunityDraft  │
└──────────────────────────────┘  │  · queryOrder / logistics  │
                                  │  · getVisitHistory         │
                                  │  · writeAiLog              │
                                  └────────────┬───────────────┘
                                               │
┌──────────────────────────────────────────────▼──────────────┐
│ 数据层 Data —— 仅 Dataverse                                  │
│  【业务实体·临时代替 Virtual Tables】                          │
│    crxxx_account / contact / opportunity / order … 种子数据   │
│  【AI 操作面】activity 草稿、对话上下文、confidence、日志       │
│  写入三段式：draft → confirmed → synced（synced = 模拟回写）   │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ 治理层 Governance（Demo 最小集）                               │
│  Dataverse 安全角色 / App User · 调用审计表 · Prompt 版本字段  │
└─────────────────────────────────────────────────────────────┘
```

### 3.1 与原方案组件对照

| 原方案组件 | Demo 替代 | 说明 |
| --- | --- | --- |
| Power Apps Code App (React) | Vite + React SPA（移动优先） | 可后续迁入 Code App |
| Copilot Studio + Generative Orchestration | 自研 Orchestrator + Domain Agents | DeepSeek 驱动 |
| Agent Flow | 后端编排函数 / 状态机 | 拜访流水串行 |
| **AI Builder Prompt / Form / Extraction** | **DeepSeek Chat + JSON 约束输出** | 无 AI Builder 依赖 |
| Web Speech API | 同左 | 浏览器原生转写 |
| Dataverse（AI 元数据） | **真实 Dataverse 表** | 草稿、日志、会话 |
| Virtual Tables → SAP | **Dataverse 普通表 + 种子数据** | 表命名/字段贴近未来 VT，便于替换 |
| Azure Service Bus 回写 SAP | 状态字段 `synced` + 可选 Power Automate 占位 | 演示三段态即可 |
| Azure OpenAI / 多模型 | **仅 DeepSeek** | 编排与认知共用同一模型 |

### 3.2 DeepSeek 用法约定（替代 AI Builder）

| 原 AI Builder 能力 | DeepSeek 实现 |
| --- | --- |
| Prompt (GPT) 摘要/改写 | Chat Completions + 固定 system prompt |
| 实体抽取 | 强制 JSON Schema / 严格 JSON 模式输出 |
| 意图分类 | 小 prompt 分类 → `capture_visit` / `query_account` / `query_order` / `clarify` |
| Form Processing / OCR | **本 Demo 不做**（无铭牌拍照主链路） |
| Tool Calling | DeepSeek function calling（若端点支持）；否则「计划 JSON → 本地执行工具」两段式 |

> 实现建议：抽取引擎与 Orchestrator **共用一个 DeepSeek 客户端封装**；temperature 偏低（如 0.1～0.3）；关键路径可对固定演示话术做缓存兜底，避免演示翻车。

### 3.3 Virtual Tables 临时替代策略

原方案读路径是 Virtual Tables 直连 SAP。当前无 VT 时：

1. 在 Dataverse 建一组 **普通自定义表**，语义对齐未来 SAP/VT 实体（客户、联系人、商机、订单、物流）。  
2. 用种子数据灌入 3～5 家医院及关联商机/订单（如「上海仁济医院」）。  
3. Tool 层只依赖 **表逻辑名 + Web API**，不写死「这是 Mock」；日后换成真实 VT 时，主要改连接与表映射，Agent 契约不变。  
4. 「回写 SAP」在 Demo 中 = 将记录 `status` 更新为 `synced`（可附加 `synced_at`）；不接真实 Service Bus。

```
原方案:  UI → Agent → Dataverse VT ──读──► SAP
                      Dataverse ──SB 写──► SAP

本 Demo: UI → Agent → Dataverse 业务表（临时代替 VT，读写都在 DV）
                      status: draft | confirmed | synced（synced 仅语义占位）
```

---

## 4. 业务对象与 Dataverse 表（最小集）

建议前缀统一（示例 `crmai_`），实际以环境发布名为准。

```
crmai_account（客户 · 临时代替 VT）
  crmai_accountid, crmai_name, crmai_region, crmai_creditlevel,
  crmai_lastvisitat, …

crmai_contact（联系人）
  crmai_contactid, crmai_accountid, crmai_name, crmai_title, …

crmai_activity（活动/拜访 · AI 操作面为主）
  crmai_activityid, crmai_accountid, crmai_contactid?,
  crmai_type, crmai_occurredat, crmai_summary, crmai_nextfollowupat?,
  crmai_syncstatus (draft|confirmed|synced|discarded),
  crmai_sourcetranscript, crmai_confidence, crmai_createdbyagent

crmai_opportunity（商机 · 临时代替 VT）
  crmai_opportunityid, crmai_accountid, crmai_productline, crmai_productmodel,
  crmai_quantity, crmai_amount?, crmai_stage, crmai_confidencescore,
  crmai_syncstatus, crmai_linkedactivityid?, …

crmai_order / crmai_shipment（订单/物流 · 场景 C，临时代替 VT）
  …

crmai_aiinvocationlog（治理）
  sessionid, agentname, inputsummary, outputenvelope, latencyms, promptversion
```

**写入状态机：**

```
draft ──Confirm──► confirmed ──(模拟回写)──► synced
  │
  └──Discard──► discarded    Edit → 回到可编辑 draft
```

---

## 5. Agent 与消息契约

### 5.1 Demo Agent 清单

| Agent | 职责 | 模型 / 数据 |
| --- | --- | --- |
| **Orchestrator** | 意图识别、路由、扇出/串行、合成回复 | DeepSeek |
| **EntityExtract** | 口语 → 结构化字段 | DeepSeek JSON |
| **AccountProfile** | 客户存在性、近 30 天拜访、信用摘要 | Dataverse 查询 + DeepSeek 摘要 |
| **ActivityCreate** | 生成活动草稿 | DeepSeek + Dataverse 写草稿 |
| **OpportunityCreate** | 生成/关联商机草稿 + 重复检测提示 | DeepSeek + Dataverse |
| **OrderQuery**（选做） | 订单与物流 | Dataverse 临时订单表 |

### 5.2 Message Envelope（统一契约）

```json
{
  "role": "assistant",
  "agent_name": "OpportunityCreate",
  "content": "检测到对该客户已有 N17 商机，建议追加活动证据而非新建。",
  "sources": [
    {
      "type": "dataverse",
      "entity": "crmai_opportunity",
      "id": "…guid…",
      "label": "仁济 · N17 · Identify"
    }
  ],
  "confidence": 0.86,
  "draft": {
    "entity": "Opportunity",
    "action": "link_or_create",
    "payload": { }
  }
}
```

前端只消费该结构；`sources` 一律可追溯到 Dataverse 记录。

### 5.3 协作模式

| 模式 | Demo 用法 |
| --- | --- |
| Sequential | 拜访录入：抽取 → 画像 → 活动 → 商机 |
| Fan-out | 「客户怎么样」：画像 ∥ 商机摘要 |
| Routing | 模糊意图先分类再单路调用 |
| Review-Loop | 写操作只出 draft，Confirm 后写 Dataverse |

---

## 6. 技术选型建议

### 6.1 推荐栈（贴合当前可用资源）

| 层 | 技术 | 理由 |
| --- | --- | --- |
| 前端 | React 18 + Vite + TypeScript | 对齐 Code App 思路；移动 Web 演示 |
| UI | 轻量自研组件 + CSS Variables | 麦克风、草稿卡、气泡 |
| 语音 | Web Speech API | 与原方案一致；键盘 fallback |
| 后端 | Node (Nest/Express) **或** Python (FastAPI) | 承载 Orchestrator；调 DeepSeek + Dataverse |
| 编排 | DeepSeek Tool Calling 或「计划 JSON + 本地执行」 | 替代 Copilot Studio |
| LLM | **仅 DeepSeek** | 抽取 / 分类 / 摘要 / 编排共用 |
| 数据 | **Microsoft Dataverse** | 唯一数据源；VT 用普通表临时代替 |
| Dataverse 接入 | Web API + 服务主体 / 交互式登录 | Tool 层统一 Repository |
| 部署 | 前端静态托管 + API 可部署 Azure/本地；Dataverse 用现有环境 | 无需自建业务库 |

### 6.2 仓库建议结构

```
mindray-crm-ai/
├── docs/
│   └── demo-plan.md              ← 本文
├── apps/
│   └── web/                      ← React 移动端
├── services/
│   └── api/                      ← Orchestrator + Agents + DeepSeek + DV 客户端
├── dataverse/
│   ├── solution/                 ← 表/列/安全角色（可后续 Solution 打包）
│   └── seed/                     ← 客户/商机/订单种子（JSON 或脚本写入 DV）
└── README.md
```

> 不再以 SQLite/Postgres 作为业务库；本地最多缓存会话，权威数据在 Dataverse。

---

## 7. 界面范围

| 屏幕 | Demo 是否做 | 要点 |
| --- | --- | --- |
| 今日大盘 Home | 做简化版 | KPI 从 Dataverse 聚合 |
| 今日播报 Brief Me | 可选/跳过 | — |
| 活动录入 | **必做** | 语音/文本 → DeepSeek 抽取 → 草稿卡 |
| 客户查询对话 | **必做** | Envelope + sources |
| 商机创建 | 并入活动结果卡 | — |

**交互硬规则：**

1. 主动作是麦克风；键盘是 fallback。  
2. AI 输出必须标「AI 草稿」+ 置信度，写入前可编辑。  
3. 气泡上方明示 `agent_name`。  
4. 写路径可视化：`draft / confirmed / synced`。

---

## 8. 实施计划（仅 Demo，约 1～2 周）

### Day 0 — 对齐与骨架

- [ ] 确认 DeepSeek API 端点、Key、模型名（及是否支持 function calling）  
- [ ] 确认 Dataverse 环境 URL、应用用户/权限  
- [ ] 初始化 `web` + `api`；定义 Message Envelope 类型  

### Day 1 — Dataverse 表 + 种子（临时代替 VT）

- [ ] 创建 account / contact / activity / opportunity（+ 可选 order）表  
- [ ] 写入 3～5 家医院及关联商机/订单种子  
- [ ] API 侧 Dataverse CRUD 封装打通（读一条客户、写一条草稿）  

### Day 2 — DeepSeek 认知层

- [ ] DeepSeek 客户端封装（超时、重试、JSON 解析容错）  
- [ ] EntityExtract：口语 → 固定 JSON schema  
- [ ] 意图分类小模型调用（同一 DeepSeek）  
- [ ] 文本录入通路端到端（暂不依赖语音）  

### Day 3 — Orchestrator + 拜访流水

- [ ] Orchestrator 路由：录入 / 查客户 / 查订单 / 澄清  
- [ ] Sequential：抽取 → 画像 → 活动草稿 → 商机草稿  
- [ ] Confirm 写 Dataverse + `syncstatus` 流转  

### Day 4 — 前端主流程

- [ ] Home + 对话页 + 草稿卡 Confirm/Edit/Discard  
- [ ] Web Speech（Chrome/Edge）  
- [ ] 低置信度反问（缺客户名等）  

### Day 5 — 场景 B/C + 演示打磨

- [ ] 客户速览 Fan-out  
- [ ] （选做）订单/物流  
- [ ] 3 条固定演示话术 + 对 DeepSeek 关键路径的兜底缓存（可选）  
- [ ] README：环境变量（DeepSeek + Dataverse）说明  

### 验收 Checklist

- [ ] **无 Copilot Studio、无 AI Builder** 即可跑通  
- [ ] LLM 调用**仅 DeepSeek**  
- [ ] 业务读写**仅 Dataverse**；无独立业务库  
- [ ] 客户/商机等读路径来自「临时代替 VT」的普通表种子数据  
- [ ] Confirm 后可在 Dataverse 中看到 Activity/Opportunity  
- [ ] 每条 AI 回复含 `agent_name` / `sources` / `confidence`  
- [ ] 文本路径 100% 可演示；语音为加分项  

---

## 9. 演示脚本（建议）

1. **开场（Home）** — KPI 来自 Dataverse 聚合。  
2. **录入** — 仁济医院话术 → DeepSeek 抽取 → 活动 + 商机草稿卡。  
3. **督导** — 种子中已有 N17 商机时提示「建议关联而非新建」。  
4. **确认** — Confirm → Dataverse `confirmed` → 短暂后 `synced`（模拟回写）。  
5. **查询** — 「仁济医院最近怎么样？」→ 画像 + 商机并行摘要，sources 指向 DV。  
6. **（可选）订单** — 物流状态来自临时订单表。

---

## 10. 风险与边界

| 风险 | 应对 |
| --- | --- |
| 无 Copilot / 无 AI Builder | 自研编排 + DeepSeek；能力面收窄到结构化抽取与调度 |
| 仅 DeepSeek | 统一客户端；JSON 解析加强容错；演示话术可缓存兜底 |
| 无真实 Virtual Tables | Dataverse 普通表 + 种子；接口按「可换 VT」设计 |
| 无 SAP 回写 | `synced` 仅状态语义；文档标明非真实 SoR 回流 |
| DeepSeek Tool Calling 不稳定 | 降级为「模型输出计划 JSON → 服务端执行工具」 |
| Dataverse 延迟 / 权限 | 提前配好 Application User 与表权限；演示账号只读+写草稿 |

---

## 11. 后续与原方案接轨（备忘）

| 现在（Demo） | 具备条件后 |
| --- | --- |
| DeepSeek | 可并行接入 AI Builder / Azure OpenAI，抽象 `ILLMProvider` |
| 自研 Orchestrator | 迁 Copilot Studio Generative Orchestration |
| Dataverse 普通表（VT 替身） | 换成真实 Virtual Tables 指向 SAP |
| `synced` 状态位 | Azure Service Bus → SAP 异步回写 |
| React SPA | Power Apps Code App / 嵌入 |

**本 Demo 目标：** 在「仅 DeepSeek + 仅 Dataverse、无 Copilot/无 AI Builder」前提下，证明「对话 → 多 Agent → 草稿确认 → Dataverse 落库」主链成立。

---

## 12. 一句话结论

**业务上**打穿「拜访录入 + 客户速览（+ 可选订单）」；  
**技术上**用 React 移动 Web + **DeepSeek 自研编排（替代 Copilot + AI Builder）** + **Dataverse 唯一数据源（普通表临时代替 Virtual Tables）**，对齐原方案五层，作为可运行的小型验证 Demo。
