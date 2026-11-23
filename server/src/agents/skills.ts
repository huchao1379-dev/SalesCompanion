/**
 * Skill catalog — single source of truth for IntentRouter.
 * Add a new CRM capability here (plus Intent type + pipeline), not by piling keywords.
 */
import type { Intent } from '../types.js'

export type SkillDef = {
  /** Stable id for logging / future tool-calling. */
  id: string
  intent: Intent
  name: string
  /** Short description shown to the router LLM. */
  description: string
  /** When the router should pick this skill. */
  whenToUse: string
  examples: string[]
  /**
   * Optional high-precision utterance guard.
   * Used only as a safety override after LLM (or in heuristic fallback),
   * not as the primary way to grow coverage.
   */
  hardMatch?: (text: string) => boolean
}

/** Routable skills the IntentRouter may choose among. */
export const ROUTABLE_SKILLS: SkillDef[] = [
  {
    id: 'capture_visit',
    intent: 'capture_visit',
    name: '拜访录入',
    description: '把已发生或将发生的拜访/电话/演示整理成活动与商机草稿',
    whenToUse:
      '用户描述了拜访内容、联系人、产品兴趣、台数，或明确说录入/记一下/建草稿',
    examples: [
      '刚拜访完仁济张主任，对 N17 感兴趣，要 12 台',
      '记一下：Hospital Alpha 对 A1 有兴趣，大概 8 台',
    ],
  },
  {
    id: 'list_accounts',
    intent: 'list_accounts',
    name: '客户列表',
    description: '列出种子库客户或客户数量，不点名某一家',
    whenToUse: '询问有哪些客户、客户清单、一共几家客户',
    examples: ['我的客户有哪些？', '种子库一共几家客户', '列出客户'],
    hardMatch: (text) =>
      /我的客户有哪些|有哪些客户|客户有哪些|客户列表|列出客户|客户清单|一共几家客户|有几家客户|种子.*(客户|医院)|所有客户|全部客户/.test(
        text,
      ) || /^(客户|医院)(有哪些|列表|清单)?[？?]*$/.test(text.trim()),
  },
  {
    id: 'query_account',
    intent: 'query_account',
    name: '客户画像',
    description: '查询某一家客户的画像、信用、近访、开放商机或进度',
    whenToUse: '点名某家医院/客户，或可从多轮继承客户后问进度/画像/商机',
    examples: ['仁济医院最近怎么样？', '总结仁济的情况', '那它的商机呢？'],
  },
  {
    id: 'query_order',
    intent: 'query_order',
    name: '订单物流',
    description: '查询订单、发货、物流、清关、ETA、运单',
    whenToUse: '明确在问订单或物流状态',
    examples: ['查一下仁济医院上个订单的物流', '上个订单物流怎么样了'],
  },
  {
    id: 'work_summary',
    intent: 'work_summary',
    name: '工作总结',
    description: '根据本人今日/本周拜访生成日报或工作小结',
    whenToUse: '对象是“我的工作/今天的拜访”，不是某家客户的情况',
    examples: ['帮我写今日工作小结', '总结我今天的拜访', '写个周报'],
  },
  {
    id: 'general_assist',
    intent: 'general_assist',
    name: '通用助手',
    description: '话术、邮件、会议准备、竞品思路、翻译、网页检索与通用问答',
    whenToUse:
      '与 CRM 种子库读写无关，但仍需助手帮助；或无法归入其他 CRM 技能时的默认出口',
    examples: [
      '帮我写一封拜访后的跟进邮件',
      '监护仪卖点怎么讲',
      '搜索一下集采政策',
    ],
  },
  {
    id: 'clarify',
    intent: 'clarify',
    name: '澄清反问',
    description: '能力询问、打招呼，或信息不足需要反问槽位',
    whenToUse:
      '仅用于 capability/greeting，或缺少客户名/动作且无法安全推断时；不要把通用问答硬塞进 clarify',
    examples: ['你能做什么？', '你好', '这单怎么样了', '上海仁济医院'],
  },
]

export function listRoutableSkills(): SkillDef[] {
  return ROUTABLE_SKILLS
}

/** Intent literals declared by the skill catalog (single source of truth). */
export function routableIntents(): Intent[] {
  return ROUTABLE_SKILLS.map((skill) => skill.intent)
}

export function skillByIntent(intent: Intent): SkillDef | undefined {
  return ROUTABLE_SKILLS.find((skill) => skill.intent === intent)
}

/** High-precision overrides that may correct LLM misroutes. */
export function findHardMatchSkill(utterance: string): SkillDef | undefined {
  const text = utterance.trim()
  if (!text) return undefined
  return ROUTABLE_SKILLS.find((skill) => skill.hardMatch?.(text))
}

/** Compact catalog for the router prompt / structured user payload. */
export function skillsForRouterPrompt() {
  return ROUTABLE_SKILLS.map((skill) => ({
    intent: skill.intent,
    name: skill.name,
    description: skill.description,
    whenToUse: skill.whenToUse,
    examples: skill.examples,
  }))
}
