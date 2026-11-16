import type {
  ActivityDraftPayload,
  AgentMessage,
  OpportunityDraftPayload,
  OrchestratorRequest,
  OrchestratorResponse,
  SourceRef,
} from './types'

const USE_MOCK = true

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

function nowIso() {
  return new Date().toISOString()
}

function nextWednesdayLabel(): string {
  const d = new Date()
  const day = d.getDay()
  const add = (3 - day + 7) % 7 || 7
  d.setDate(d.getDate() + add)
  return d.toISOString().slice(0, 10)
}

/** Renji Hospital demo — docs/03-agent-architecture.md */
function buildRenjiMock(utterance: string): OrchestratorResponse {
  const sources: SourceRef[] = [
    { kind: 'sap', label: '上海仁济医院 · Account', ref: 'SAP-ACC-RENJI' },
    { kind: 'dataverse', label: '近 30 天拜访 ×4', ref: 'VT-ACT-30D' },
    { kind: 'sap', label: '监护仪 N17 商机 Identify', ref: 'SAP-OPP-N17' },
  ]

  const activityKey = uid('act')
  const opportunityKey = uid('opp')
  const followUp = nextWednesdayLabel()

  const activity: ActivityDraftPayload = {
    kind: 'activity',
    subject: '拜访上海仁济医院 · 张主任 · 监护仪 N17',
    summary:
      '拜访张主任，其对监护仪 N17 感兴趣，意向约 12 台；约定下周三再约定标书细节。',
    visitType: 'Visit',
    accountName: '上海仁济医院',
    contactName: '张主任',
    followUpAt: followUp,
    transcript: utterance,
    syncStatus: 'Draft',
    confidence: 0.91,
    sources,
    agentName: '活动创建 Agent',
    idempotencyKey: activityKey,
  }

  const opportunity: OpportunityDraftPayload = {
    kind: 'opportunity',
    name: '上海仁济医院 · 监护仪 N17',
    accountName: '上海仁济医院',
    productLine: '监护仪 N17',
    quantity: 12,
    estimatedValue: 144000,
    currency: 'USD',
    stage: 'Identify',
    closeDate: '2026-09-30',
    confidence: 0.78,
    reuseExisting: true,
    existingOpportunityRef: 'SAP-OPP-N17',
    supervisorHints: [
      '已存在 N17 商机（Identify）— 建议追加为本活动证据，不新建商机',
      '12 台 + 信用 A → 建议升级到 Qualify，下一步发送报价',
    ],
    syncStatus: 'Draft',
    sources,
    agentName: '商机创建 Agent',
    idempotencyKey: opportunityKey,
    linkedActivityKey: activityKey,
  }

  const chain = [
    '实体抽取',
    '客户画像 Agent',
    '活动创建 Agent',
    '商机创建 Agent',
    '商机督导 Agent',
  ]

  const composite: AgentMessage = {
    id: uid('msg'),
    role: 'assistant',
    agent_name: 'Orchestrator',
    content:
      '已识别「活动录入 + 商机线索」。仁济医院已存在（信用 A / 近 30 天 4 次拜访）。已生成活动草稿；商机侧建议追加既有 N17 商机证据，并提示阶段升级到 Qualify。请确认或编辑后提交。',
    sources,
    confidence: 0.88,
    agent_chain: chain,
    createdAt: nowIso(),
  }

  const activityMsg: AgentMessage = {
    id: uid('msg'),
    role: 'assistant',
    agent_name: activity.agentName,
    content: activity.summary,
    sources: activity.sources,
    confidence: activity.confidence,
    draft: activity,
    createdAt: nowIso(),
  }

  const opportunityMsg: AgentMessage = {
    id: uid('msg'),
    role: 'assistant',
    agent_name: opportunity.agentName,
    content: opportunity.reuseExisting
      ? `建议追加既有商机 ${opportunity.existingOpportunityRef}，不新建。`
      : '已生成新商机草稿。',
    sources: opportunity.sources,
    confidence: opportunity.confidence,
    draft: opportunity,
    createdAt: nowIso(),
  }

  return {
    messages: [composite, activityMsg, opportunityMsg],
    drafts: [activity, opportunity],
    context: {
      accountId: 'SAP-ACC-RENJI',
      accountName: '上海仁济医院',
      opportunityId: 'SAP-OPP-N17',
    },
  }
}

function buildGenericMock(utterance: string): OrchestratorResponse {
  const sources: SourceRef[] = [
    { kind: 'other', label: '语音转写', ref: 'speech' },
  ]
  const activityKey = uid('act')
  const activity: ActivityDraftPayload = {
    kind: 'activity',
    subject: utterance.slice(0, 40) || '语音拜访记录',
    summary: utterance || '（空转写）请编辑摘要后确认。',
    visitType: 'Visit',
    accountName: '待确认客户',
    contactName: '待确认联系人',
    followUpAt: nextWednesdayLabel(),
    transcript: utterance,
    syncStatus: 'Draft',
    confidence: 0.55,
    sources,
    agentName: '客户拜访 Agent',
    idempotencyKey: activityKey,
  }

  const msg: AgentMessage = {
    id: uid('msg'),
    role: 'assistant',
    agent_name: '客户拜访 Agent',
    content: '已根据口述生成活动草稿。置信度偏低，请核对客户与联系人后确认。',
    sources,
    confidence: 0.55,
    draft: activity,
    agent_chain: ['实体抽取', '客户拜访 Agent'],
    createdAt: nowIso(),
  }

  return {
    messages: [msg],
    drafts: [activity],
    context: {},
  }
}

async function mockOrchestrate(req: OrchestratorRequest): Promise<OrchestratorResponse> {
  await new Promise((r) => setTimeout(r, 650))
  const text = req.utterance.trim()
  if (/仁济|N17|张主任|监护仪/.test(text) || text.length > 20) {
    return buildRenjiMock(text || '刚拜访完上海仁济医院张主任，他对监护仪 N17 感兴趣，要 12 台，下周三再约。')
  }
  return buildGenericMock(text)
}

/**
 * Single entry for all mic / chat intents.
 * Phase 1: mock. Later: Copilot Studio / custom API — keep this signature.
 */
export async function orchestrate(req: OrchestratorRequest): Promise<OrchestratorResponse> {
  if (!USE_MOCK) {
    throw new Error('Live orchestrator not configured — set connector in power.config.json')
  }
  return mockOrchestrate(req)
}

export function isMockOrchestrator(): boolean {
  return USE_MOCK
}
