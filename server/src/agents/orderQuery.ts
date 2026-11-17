import { chatJson, hasDeepSeek } from '../llm/deepseek.js'
import type { AgentMessage, SourceRef } from '../types.js'
import { resolveAccount } from './accountProfile.js'
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

  const content = [
    `${account.name} 最近订单「${latest.name}」状态：${latest.status}`,
    `下单日 ${latest.orderedAt} · 金额 ${latest.currencyCode} ${latest.amount.toLocaleString()}`,
    shipment
      ? `物流：${shipment.status} · 运单 ${shipment.trackingNo} · ETA ${shipment.eta}`
      : '暂无物流明细',
  ].join('。')

  return {
    id: `msg_${Math.random().toString(36).slice(2, 10)}`,
    role: 'assistant',
    agent_name: '订单查询 Agent',
    content,
    sources,
    confidence: 0.88,
    agent_chain: ['Orchestrator', '订单查询 Agent', '物流查询 Agent'],
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
      system: `你是订单/物流查询 Agent。只根据 facts 用中文简洁回答销售问题，禁止编造。只输出 JSON：{"answer":"...","confidence":0-1}`,
      user: JSON.stringify({
        question: utterance,
        facts: {
          account: account.name,
          order: latest,
          shipment: shipment || null,
        },
      }),
      temperature: 0.15,
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
