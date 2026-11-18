import {
  chatWithTools,
  hasDeepSeek,
  parseStructuredJson,
} from '../llm/deepseek.js'
import { orderQueryOutputSchema } from '../llm/schemas.js'
import type { AccountRecord, AgentMessage, SourceRef } from '../types.js'
import {
  getAccount,
  getOrderLogistics,
} from '../tools/dataverseTools.js'
import {
  orderLogisticsToolResultSchema,
  orderQueryTools,
} from '../tools/readOnlyAgentTools.js'
import { ORDER_QUERY_SYSTEM } from './prompts.js'

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
        ? `${facts.account.name}「${latest.name}」物流目前是 ${facts.shipment.status}，运单 ${facts.shipment.trackingNo}，ETA ${facts.shipment.eta}。订单本身状态为 ${latest.status}（下单 ${latest.orderedAt}）。`
        : `${facts.account.name}「${latest.name}」订单状态 ${latest.status}，但暂无物流明细可查。可补充运单号后再问我。`
    } else if (askAmount) {
      content = `${facts.account.name} 最近订单「${latest.name}」金额 ${latest.currencyCode} ${latest.amount.toLocaleString()}，状态 ${latest.status}，下单日 ${latest.orderedAt}${
        facts.shipment ? `；物流 ${facts.shipment.status}（ETA ${facts.shipment.eta}）` : '；暂无物流明细'
      }。`
    } else {
      content = [
        `${facts.account.name} 最近一笔是「${latest.name}」，状态 ${latest.status}。`,
        `下单 ${latest.orderedAt}，金额 ${latest.currencyCode} ${latest.amount.toLocaleString()}。`,
        facts.shipment
          ? `物流侧：${facts.shipment.status} · 运单 ${facts.shipment.trackingNo} · ETA ${facts.shipment.eta}。`
          : '当前没有关联物流记录。',
      ].join('')
    }
  }

  return {
    id: `msg_${Math.random().toString(36).slice(2, 10)}`,
    role: 'assistant',
    agent_name: '订单查询 Agent',
    content,
    sources,
    confidence: latest ? 0.88 : 0.7,
    agent_chain: ['Orchestrator', '订单查询 Agent'],
    createdAt: new Date().toISOString(),
  }
}

async function resolveOrderFacts(
  utterance: string,
  knownAccountId?: string,
  knownAccountName?: string,
) {
  const knownAccount = knownAccountId ? await getAccount(knownAccountId) : undefined
  const result = await getOrderLogistics(knownAccount?.name || knownAccountName || utterance)
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
): Promise<{ message: AgentMessage; mode: 'deepseek' | 'heuristic' }> {
  let fallback: AgentMessage
  try {
    const facts = await resolveOrderFacts(utterance, knownAccountId, knownAccountName)
    if (!facts) {
      fallback = {
        id: `msg_${Math.random().toString(36).slice(2, 10)}`,
        role: 'assistant',
        agent_name: '订单查询 Agent',
        content: '未识别到客户。请说明医院名称，例如「查一下仁济医院上个订单的物流」。',
        sources: [],
        confidence: 0.4,
        agent_chain: ['Orchestrator', '订单查询 Agent'],
        createdAt: new Date().toISOString(),
      }
    } else {
      fallback = messageFromFacts(utterance, facts)
    }
  } catch {
    fallback = {
      id: `msg_${Math.random().toString(36).slice(2, 10)}`,
      role: 'assistant',
      agent_name: '订单查询 Agent',
      content: '暂时无法读取订单数据，请稍后再试。',
      sources: [],
      confidence: 0.3,
      agent_chain: ['Orchestrator', '订单查询 Agent'],
      createdAt: new Date().toISOString(),
    }
  }
  if (!hasDeepSeek() || fallback.confidence < 0.5 || fallback.sources.length === 0) {
    return { message: fallback, mode: 'heuristic' }
  }

  try {
    const { finalText, toolResults } = await chatWithTools({
      system: `${ORDER_QUERY_SYSTEM}\n\n必须调用 get_order_logistics 查询事实，再作答。有 knownAccountName 时将其作为工具 query；否则从用户问题中提取客户名。只输出 JSON：{"answer":"...","confidence":0到1,"focus":"status|eta|amount|missing"}。不得补充工具结果之外的状态、日期、金额或运单信息。`,
      user: JSON.stringify({
        question: utterance,
        knownAccountId: knownAccountId ?? null,
        knownAccountName: knownAccountName ?? null,
      }),
      tools: orderQueryTools,
      temperature: 0.2,
      maxToolRounds: 3,
    })
    const rawFacts = toolResults.find((item) => item.name === 'get_order_logistics')?.result
    const facts = orderLogisticsToolResultSchema.parse(rawFacts)
    const output = parseStructuredJson(finalText, orderQueryOutputSchema)
    return {
      mode: 'deepseek',
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
