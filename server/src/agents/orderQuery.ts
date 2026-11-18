import { chatJson, hasDeepSeek } from '../llm/deepseek.js'
import type { AgentMessage, SourceRef } from '../types.js'
import { resolveAccount } from './accountProfile.js'
import { ORDER_QUERY_SYSTEM } from './prompts.js'
import { store } from '../store/dataverseStore.js'

function buildHeuristic(utterance: string): AgentMessage {
  const account = resolveAccount(utterance)
  if (!account) {
    return {
      id: `msg_${Math.random().toString(36).slice(2, 10)}`,
      role: 'assistant',
      agent_name: '订单查询 Agent',
      content: '未识别到客户。请说明医院名称，例如「查一下仁济医院上个订单的物流」。',
      sources: [],
      confidence: 0.4,
      agent_chain: ['Orchestrator', '订单查询 Agent'],
      createdAt: new Date().toISOString(),
    }
  }

  const orders = store.getOrdersForAccount(account.id)
  const latest = orders.sort((a, b) => b.orderedAt.localeCompare(a.orderedAt))[0]
  if (!latest) {
    return {
      id: `msg_${Math.random().toString(36).slice(2, 10)}`,
      role: 'assistant',
      agent_name: '订单查询 Agent',
      content: `${account.name} 暂无订单种子数据。`,
      sources: [
        {
          kind: 'dataverse',
          label: account.name,
          entity: 'crmai_account',
          id: account.id,
          ref: account.externalKey,
        },
      ],
      confidence: 0.7,
      agent_chain: ['Orchestrator', '订单查询 Agent'],
      createdAt: new Date().toISOString(),
    }
  }

  const shipment = store.getShipmentForOrder(latest.id)
  const sources: SourceRef[] = [
    {
      kind: 'dataverse',
      label: latest.name,
      entity: 'crmai_order',
      id: latest.id,
      ref: latest.externalKey,
    },
  ]
  if (shipment) {
    sources.push({
      kind: 'dataverse',
      label: `${shipment.name} · ${shipment.status}`,
      entity: 'crmai_shipment',
      id: shipment.id,
      ref: shipment.trackingNo,
    })
  }

  const askEta = /物流|ETA|eta|到哪|发货|清关|到港|运单/.test(utterance)
  const askAmount = /金额|多少钱|费用|amount/i.test(utterance)
  let content: string
  if (askEta) {
    content = shipment
      ? `${account.name}「${latest.name}」物流目前是 ${shipment.status}，运单 ${shipment.trackingNo}，ETA ${shipment.eta}。订单本身状态为 ${latest.status}（下单 ${latest.orderedAt}）。`
      : `${account.name}「${latest.name}」订单状态 ${latest.status}，但暂无物流明细可查。可补充运单号后再问我。`
  } else if (askAmount) {
    content = `${account.name} 最近订单「${latest.name}」金额 ${latest.currencyCode} ${latest.amount.toLocaleString()}，状态 ${latest.status}，下单日 ${latest.orderedAt}${
      shipment ? `；物流 ${shipment.status}（ETA ${shipment.eta}）` : '；暂无物流明细'
    }。`
  } else {
    content = [
      `${account.name} 最近一笔是「${latest.name}」，状态 ${latest.status}。`,
      `下单 ${latest.orderedAt}，金额 ${latest.currencyCode} ${latest.amount.toLocaleString()}。`,
      shipment
        ? `物流侧：${shipment.status} · 运单 ${shipment.trackingNo} · ETA ${shipment.eta}。`
        : '当前没有关联物流记录。',
    ].join('')
  }

  return {
    id: `msg_${Math.random().toString(36).slice(2, 10)}`,
    role: 'assistant',
    agent_name: '订单查询 Agent',
    content,
    sources,
    confidence: 0.88,
    agent_chain: ['订单查询 Agent'],
    createdAt: new Date().toISOString(),
  }
}

/** DeepSeek 润色订单/物流回答；无 Key 时启发式。 */
export async function queryOrderLogistics(
  utterance: string,
): Promise<{ message: AgentMessage; mode: 'deepseek' | 'heuristic' }> {
  const fallback = buildHeuristic(utterance)
  if (!hasDeepSeek() || fallback.confidence < 0.5 || fallback.sources.length === 0) {
    return { message: fallback, mode: 'heuristic' }
  }

  const account = resolveAccount(utterance)
  if (!account) return { message: fallback, mode: 'heuristic' }

  const orders = store.getOrdersForAccount(account.id)
  const latest = orders.sort((a, b) => b.orderedAt.localeCompare(a.orderedAt))[0]
  if (!latest) return { message: fallback, mode: 'heuristic' }
  const shipment = store.getShipmentForOrder(latest.id)

  try {
    const { data, mode } = await chatJson<{ answer: string; confidence?: number }>({
      system: ORDER_QUERY_SYSTEM,
      user: JSON.stringify({
        question: utterance,
        facts: {
          account: account.name,
          order: latest,
          shipment: shipment || null,
        },
        instruction: '针对本次提问组织答复，不要机械复读固定模板。',
      }),
      temperature: 0.3,
    })
    if (!data.answer?.trim()) return { message: fallback, mode: 'heuristic' }
    return {
      mode,
      message: {
        ...fallback,
        content: data.answer.trim(),
        confidence: Math.max(0, Math.min(1, data.confidence ?? 0.88)),
      },
    }
  } catch {
    return { message: fallback, mode: 'heuristic' }
  }
}
