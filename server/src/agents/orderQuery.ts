import {
  chatWithTools,
  hasLlm,
  llmSuccessMode,
  parseStructuredJson,
} from '../llm/deepseek.js'
import type { LlmSuccessMode } from '../llm/types.js'
import { orderQueryOutputSchema } from '../llm/schemas.js'
import type {
  AccountRecord,
  AgentMessage,
  MessageUiBlock,
  SourceRef,
} from '../types.js'
import {
  getAccount,
  getOrderLogistics,
} from '../tools/dataverseTools.js'
import {
  orderLogisticsToolResultSchema,
  orderQueryTools,
} from '../tools/readOnlyAgentTools.js'
import { ORDER_QUERY_SYSTEM, ORDER_QUERY_TOOL_ADDENDUM } from './prompts.js'
import { resolveAccount } from './accountProfile.js'
import { nowIsoInZone } from '../util/datetime.js'

type OrderFact = {
  id: string
  externalKey: string
  name: string
  accountId: string
  status: string
  orderedAt: string
  amount: number
  currencyCode: string
}

type OrderFacts = {
  account: Pick<AccountRecord, 'id' | 'name' | 'externalKey'>
  orders: OrderFact[]
  latestOrder: OrderFact | null
  shipment: {
    id: string
    orderId: string
    name: string
    status: string
    eta: string
    trackingNo: string
  } | null
}

function messageFromFacts(utterance: string, facts: OrderFacts): AgentMessage {
  const latest = facts.latestOrder
  const sources: SourceRef[] = [
    {
      kind: 'dataverse',
      label: facts.account.name,
      entity: 'crmai_account',
      id: facts.account.id,
      ref: facts.account.externalKey,
    },
  ]

  if (latest) {
    sources.push({
      kind: 'dataverse',
      label: latest.name,
      entity: 'crmai_order',
      id: latest.id,
      ref: latest.externalKey,
    })
  }
  if (facts.shipment) {
    sources.push({
      kind: 'dataverse',
      label: `${facts.shipment.name} · ${facts.shipment.status}`,
      entity: 'crmai_shipment',
      id: facts.shipment.id,
      ref: facts.shipment.trackingNo,
    })
  }

  let content: string
  if (!latest) {
    content = `${facts.account.name} 暂无订单种子数据。`
  } else {
    const askEta = /物流|ETA|eta|到哪|发货|清关|到港|运单/.test(utterance)
    const askAmount = /金额|多少钱|费用|amount/i.test(utterance)
    if (askEta) {
      content = facts.shipment
        ? `${facts.account.name}「${latest.name}」物流 ${facts.shipment.status}，ETA ${facts.shipment.eta}。`
        : `${facts.account.name}「${latest.name}」暂无物流明细。`
    } else if (askAmount) {
      content = `${facts.account.name} 最近订单金额 ${latest.currencyCode} ${latest.amount.toLocaleString()}，状态 ${latest.status}。`
    } else {
      content = `${facts.account.name} 最近订单「${latest.name}」，状态 ${latest.status}。`
    }
  }

  const ui: MessageUiBlock | undefined = latest
    ? {
        type: 'order_status',
        title: facts.account.name,
        metrics: [
          {
            label: '金额',
            value: `${latest.currencyCode} ${latest.amount.toLocaleString()}`,
            tone: 'accent',
          },
          {
            label: '订单状态',
            value: latest.status,
            tone: 'neutral',
          },
          ...(facts.shipment
            ? [
                {
                  label: '物流',
                  value: facts.shipment.status,
                  tone: 'good' as const,
                },
                {
                  label: 'ETA',
                  value: facts.shipment.eta,
                  tone: 'neutral' as const,
                },
              ]
            : [
                {
                  label: '下单日',
                  value: latest.orderedAt,
                  tone: 'neutral' as const,
                },
              ]),
        ],
        items: [
          {
            title: latest.name,
            subtitle: facts.shipment
              ? `运单 ${facts.shipment.trackingNo}`
              : `下单 ${latest.orderedAt}`,
            badge: latest.status,
          },
        ],
        actions: [
          {
            id: 'open_account',
            label: '查看客户画像',
          },
        ],
        accountKey: facts.account.externalKey || facts.account.id,
        followUps: [
          `${facts.account.name}最近怎么样？`,
          `帮我写一封给${facts.account.name}的跟进邮件`,
          `刚拜访完${facts.account.name}，帮我生成活动草稿`,
        ],
        footnote: '订单与物流来自种子数据，请核实。',
      }
    : undefined

  return {
    id: `msg_${Math.random().toString(36).slice(2, 10)}`,
    role: 'assistant',
    agent_id: 'OrderQuery',
    agent_name: '订单查询 Agent',
    content,
    sources,
    confidence: latest ? 0.88 : 0.7,
    confidence_kind: 'answer',
    agent_chain: ['Orchestrator', '订单查询 Agent'],
    createdAt: new Date().toISOString(),
    ui,
  }
}

async function resolveOrderFacts(
  utterance: string,
  knownAccountId?: string,
  knownAccountName?: string,
) {
  const knownAccount = knownAccountId ? await getAccount(knownAccountId) : undefined
  const resolved =
    knownAccount ||
    (await resolveAccount(utterance)) ||
    (knownAccountName ? await resolveAccount(knownAccountName) : undefined)
  const result = await getOrderLogistics(resolved?.name || knownAccountName || utterance)
  if (!result) return undefined
  return {
    account: {
      id: result.account.id,
      name: result.account.name,
      externalKey: result.account.externalKey,
    },
    orders: result.orders,
    latestOrder: result.latestOrder ?? null,
    shipment: result.shipment ?? null,
  } satisfies OrderFacts
}

/** Uses model-selected read-only CRM lookup; deterministic facts remain the fallback. */
export async function queryOrderLogistics(
  utterance: string,
  knownAccountId?: string,
  knownAccountName?: string,
): Promise<{ message: AgentMessage; mode: LlmSuccessMode | 'heuristic' }> {
  let fallback: AgentMessage
  try {
    const facts = await resolveOrderFacts(utterance, knownAccountId, knownAccountName)
    if (!facts) {
      fallback = {
        id: `msg_${Math.random().toString(36).slice(2, 10)}`,
        role: 'assistant',
        agent_id: 'OrderQuery',
        agent_name: '订单查询 Agent',
        content: '未识别到客户。请说明医院名称，例如「查一下仁济医院上个订单的物流」。',
        sources: [],
        confidence: 0.4,
        confidence_kind: 'answer',
        agent_chain: ['Orchestrator', '订单查询 Agent'],
        createdAt: new Date().toISOString(),
        ui: {
          type: 'clarify',
          title: '需要客户名称',
          question: '是哪家客户的订单？',
          examples: ['查一下仁济医院上个订单的物流', 'Hospital Alpha 发货到哪了'],
          tone: 'info',
        },
      }
    } else {
      fallback = messageFromFacts(utterance, facts)
    }
  } catch {
    fallback = {
      id: `msg_${Math.random().toString(36).slice(2, 10)}`,
      role: 'assistant',
      agent_id: 'OrderQuery',
      agent_name: '订单查询 Agent',
      content: '暂时无法读取订单数据，请稍后再试。',
      sources: [],
      confidence: 0.3,
      confidence_kind: 'answer',
      agent_chain: ['Orchestrator', '订单查询 Agent'],
      createdAt: new Date().toISOString(),
    }
  }
  if (!hasLlm() || fallback.confidence < 0.5 || fallback.sources.length === 0) {
    return { message: fallback, mode: 'heuristic' }
  }

  try {
    const { finalText, toolResults, mode } = await chatWithTools({
      system: `${ORDER_QUERY_SYSTEM}\n\n${ORDER_QUERY_TOOL_ADDENDUM}`,
      user: JSON.stringify({
        question: utterance,
        knownAccountId: knownAccountId ?? null,
        knownAccountName: knownAccountName ?? null,
        now: nowIsoInZone(),
        timezone: 'Asia/Shanghai',
      }),
      tools: orderQueryTools,
      temperature: 0.2,
      maxTokens: 420,
      maxToolRounds: 3,
    })
    const rawFacts = toolResults.find((item) => item.name === 'get_order_logistics')?.result
    const facts = orderLogisticsToolResultSchema.parse(rawFacts)
    const output = parseStructuredJson(finalText, orderQueryOutputSchema)
    return {
      mode: mode || llmSuccessMode(),
      message: {
        ...messageFromFacts(utterance, facts),
        content: output.answer,
        confidence: Math.max(0, Math.min(1, output.confidence ?? fallback.confidence)),
      },
    }
  } catch {
    return { message: fallback, mode: 'heuristic' }
  }
}
