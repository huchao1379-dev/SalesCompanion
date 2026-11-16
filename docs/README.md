# SalesCompanion 文档套件

本目录是 **SalesCompanion**（销售 CRM 移动 AI 智能体）文档，对齐提案 [销售 CRM 移动 AI 智能体方案](https://illusion615.github.io/KnowledgeHub/posts/mindray-crm-ai-proposal/index.html)。

> 不再让销售「使用 CRM」，而是让 CRM「跟随销售」。

## 当前执行重点（Demo）

受环境约束（**无 Copilot Studio、无 AI Builder、无真实 VT/SB**），当前冲刺按小型可运行 Demo 推进：

| 文档 | 用途 |
| --- | --- |
| **[15 Demo 范围矩阵](15-demo-scope-matrix.md)** | **必做 / 选做 / 不做**一览（先读这篇） |
| [14 Demo 整体计划](14-demo-plan.md) | Demo 架构、场景、日程、验收 |
| [13 Dataverse 表字段规格](13-dataverse-table-spec.md) | **必建表**列定义与种子；标明不建项 |

**Demo 必做摘要：** 场景 A 拜访录入 + 场景 B 客户速览 · DeepSeek 自研编排 · Dataverse 普通表唯一数据源。  
**Demo 明确不做：** Copilot / AI Builder / 真实 SAP VT·Service Bus / Brief Me 与售后全量 / 生产 ALM 全套。

---

## 文档列表

| 编号 | 文档 | 说明 | Demo 期 |
| --- | --- | --- | --- |
| 00 | [术语表](00-glossary.md) | SoR/SoE、信封、草稿三段式 | 参考 |
| 01 | [产品总览](01-product-overview.md) | 愿景、四原则 | 参考原则 |
| 02 | [系统架构](02-system-architecture.md) | 五层架构 | 参考；组件替换见 14 |
| 03 | [Agent 架构](03-agent-architecture.md) | 协同与消息契约 | **契约必遵守** |
| 04 | [Agent 全景目录](04-agent-catalog.md) | 30+ Agent | 愿景；Demo 仅 4～5 个 |
| 05 | [界面五屏](05-ui-screens.md) | UI 信息架构 | 按 15 裁剪 |
| 06 | [数据模型](06-data-model.md) | 生产 SoE/VT 概念 | 愿景；建表看 13 |
| 07 | [SAP 集成](07-integration-sap.md) | VT + SB 回写 | **Demo 不实施** |
| 08 | [ALM 交付](08-alm-delivery.md) | Plan / Vibe / ALM | Demo 从简 |
| 09 | [实施计划](09-implementation-roadmap.md) | 6 个月四阶段 | 愿景 |
| 10 | [产品配置 SKU](10-product-sku.md) | 授权与 Credits | 愿景 |
| 11 | [成功指标](11-success-metrics.md) | 收益度量 | 愿景 |
| 12 | [开工指南](12-phase1-build-guide.md) | 本仓库清单 | **按 Demo 节执行** |
| **13** | [**Dataverse 建表规格**](13-dataverse-table-spec.md) | 列/Choice/种子 | **执行** |
| **14** | [**Demo 整体计划**](14-demo-plan.md) | 小型 Demo 权威计划 | **执行** |
| **15** | [**Demo 范围矩阵**](15-demo-scope-matrix.md) | 必做/选做/不做 | **执行** |

## 按角色阅读路径

### 正在做 Demo 的开发 / Maker（优先）

1. [15 范围矩阵](15-demo-scope-matrix.md)  
2. [14 Demo 计划](14-demo-plan.md)  
3. [13 Dataverse 建表](13-dataverse-table-spec.md)  
4. [03 消息契约](03-agent-architecture.md) · [12 开工指南](12-phase1-build-guide.md)  

### 产品 / 看愿景

1. [01 产品总览](01-product-overview.md)  
2. [09 实施计划](09-implementation-roadmap.md)  
3. [04 Agent 全景](04-agent-catalog.md)  

### 架构（生产接轨）

1. [02](02-system-architecture.md) → [06](06-data-model.md) → [07](07-integration-sap.md)  
2. 对照 [14 §11 后续接轨](14-demo-plan.md)  

## 仓库对应关系

| 仓库现状 | 文档落点 |
| --- | --- |
| React 移动 UI（五屏 + mock） | [05](05-ui-screens.md) · [12](12-phase1-build-guide.md) · [15](15-demo-scope-matrix.md) |
| Mock Orchestrator | 过渡；Demo 验收前换 DeepSeek（见 14） |
| Dataverse 尚未建表 | [13](13-dataverse-table-spec.md) **必建** 5 张 + 种子 |
| 生产 VT/SB/Copilot 文档 | 保留作接轨；**当前不做** |

## 提案原文

https://illusion615.github.io/KnowledgeHub/posts/mindray-crm-ai-proposal/index.html
