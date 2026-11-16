# 04 · Agent 全景目录

以「业务域 + 通用域」组织 Agent 体系。**★ = Phase 1 优先**（高频，直接服务一线拜访）。完整上线节奏见 [09 实施计划](09-implementation-roadmap.md)。

## 总览

| 业务域 | Agent 数（约） | Phase 1 ★ |
| --- | --- | --- |
| 客户与活动 | 7 | 活动创建、客户拜访、工作总结 |
| 商机管理 | 7 | 商机创建、商机评估 |
| 订单管理 | 6 | 订单查询、物流查询 |
| 安装与售后 | 7 | 现场服务、维修知识检索 |
| 考核与通用 | 6+ | 指标分析、智能知识库 |
| **合计** | **30+** | 分阶段投产 |

## 客户与活动 · Customer & Activity

| Agent | Phase | 说明 |
| --- | --- | --- |
| 客户画像 Agent | 2 | 聚合拜访、商机、信用、采购倾向 |
| 线索获取 Agent | 2/3 | 从外部/活动中识别线索 |
| **活动创建 Agent** ★ | 1 | 结构化活动草稿（主题、纪要、跟进等） |
| **客户拜访 Agent** ★ | 1 | 拜访场景主入口：口述 → 活动+商机线索 |
| **工作总结 Agent** ★ | 1–2 | 日报/周报草稿（可双语） |
| 竞品分析 Agent | 3+ | 竞品动态摘要 |
| 市场扫描 Agent | 3+ | 区域市场信号 |

## 商机管理 · Opportunity

| Agent | Phase | 说明 |
| --- | --- | --- |
| **商机创建 Agent** ★ | 1 | 从拜访摘要生成商机草稿；含重复检测 |
| **商机评估 Agent** ★ | 1–2 | 阶段、信心度、金额建议 |
| 销售/需求预测 Agent | 4 | 预测性洞察 |
| 标书分析 Agent | 3 | RFP / 标书要点 |
| 投标文件 Agent | 3 | 投标材料辅助 |
| 标书制作 Agent | 3+ | 生成标书草案 |
| 商机督导 Agent | 1–2 | Review-Loop：规则校验与阶段建议 |

## 订单管理 · Order

| Agent | Phase | 说明 |
| --- | --- | --- |
| 报价 Agent | 2/3 | 报价草案 |
| 下单 Agent | 3 | 下单草稿（强 Review-Loop） |
| 订单审核 Agent | 3 | 审核规则 |
| 运费核算 Agent | 3 | 运费估算 |
| **订单查询 Agent** ★ | 2 | 订单状态查询 |
| **物流查询 Agent** ★ | 2 | 清关 / 在途 / ETA |

## 安装与售后 · Service

| Agent | Phase | 说明 |
| --- | --- | --- |
| 智能派单 Agent | 3 | 工单派发建议 |
| **现场服务 Agent** ★ | 3 | 现场服务支持 |
| 故障识别 Agent | 3 | 故障代码 / 现象归类 |
| **维修知识检索 Agent** ★ | 3 | RAG 排查步骤与备件 |
| 备件推荐 Agent | 3 | 备件号推荐 |
| 质量分析 Agent | 4 | 质量趋势 |
| 预测性维护 Agent | 4 | 高阶预测 |

## 考核与通用 · Performance & Generic

| Agent | Phase | 说明 |
| --- | --- | --- |
| **指标分析 Agent** ★ | 1–2 | 今日 KPI、风险商机、播报素材 |
| 会议纪要 Agent | 2 | 会议转写摘要 |
| 流程卡点 Agent | 2/3 | 流程阻塞诊断 |
| **智能知识库 Agent** ★ | 2–3 | 组织知识问答 |
| 文件审核 Agent | 3 | 文档合规检查 |
| PPT / Excel 助手 | 3+ | 办公产出辅助 |

## Phase 与本仓库优先级

### Phase 1（本仓库首批）

必须支撑「语音拜访录入 → 活动草稿 → 商机建议 → Confirm」闭环：

1. **客户拜访 Agent**（主路径）  
2. **活动创建 Agent**  
3. **商机创建 Agent** + **商机督导 Agent**（Review-Loop）  
4. **商机评估 Agent**（可与创建同迭代）  
5. **指标分析 Agent**（Home / Brief Me 数据）  
6. **工作总结 Agent**（可紧随拜访闭环）

### Phase 2

编排框架成型后补齐：客户画像、订单查询、物流查询、工作总结强化、质量基线相关 Agent。

### Phase 3+

售后知识闭环、Teams 入口、标书与预测类高阶 Agent。

## 注册约定

新增 Domain Agent 时最少提供：

| 字段 | 要求 |
| --- | --- |
| `agent_name` | 稳定英文标识 + 中文显示名 |
| Instructions | 目标、边界、反问策略 |
| Tools | 声明所需 Tier 3 工具 |
| Knowledge | Dataverse / VT / 知识源 |
| Output contract | 遵守 [Message Envelope](03-agent-architecture.md) |
| Write policy | 只产出 draft，禁止静默直写 SAP |

## 相关文档

- [03 Agent 架构](03-agent-architecture.md)
- [09 实施计划](09-implementation-roadmap.md)
- [12 Phase 1 开工指南](12-phase1-build-guide.md)
