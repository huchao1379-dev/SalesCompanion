export type AgendaTarget = 'capture' | 'chat' | 'tasks' | 'account' | 'opportunity' | 'brief' | 'detail'

export type CalEventType = 'meeting' | 'visit' | 'call' | 'other' | 'email'

export type AgendaItem = {
  id: string
  day: number
  type: CalEventType
  title: string
  time: string
  location: string
  target: AgendaTarget
  orgName: string
  orgIndustry: string
  orgPhone: string
  notes: string
  status: 'Draft' | 'Confirmed' | 'Completed'
  contacts: Array<{ name: string; role: string; phone: string }>
}

export const EVENT_META: Record<CalEventType, { label: string; className: string }> = {
  meeting: { label: 'Meeting', className: 'is-meeting' },
  visit: { label: 'Visit', className: 'is-visit' },
  call: { label: 'Call', className: 'is-call' },
  other: { label: 'Other', className: 'is-other' },
  email: { label: 'Email', className: 'is-email' },
}

function withDefaults(
  partial: Omit<AgendaItem, 'id' | 'orgName' | 'orgIndustry' | 'orgPhone' | 'notes' | 'status' | 'contacts'> &
    Partial<Pick<AgendaItem, 'orgName' | 'orgIndustry' | 'orgPhone' | 'notes' | 'status' | 'contacts'>>,
): AgendaItem {
  return {
    id: `${partial.day}-${partial.time}-${partial.title}`,
    orgName: partial.orgName ?? 'Manchester University NHS Foundation Trust',
    orgIndustry: partial.orgIndustry ?? 'Healthcare',
    orgPhone: partial.orgPhone ?? '+44 161 276 1234',
    notes:
      partial.notes ??
      '结果: Held a Teams meeting to demo the remote consultation platform and answered questions',
    status: partial.status ?? 'Draft',
    contacts: partial.contacts ?? [
      { name: 'Dr. Tariq Hussain', role: 'Clinical Lead', phone: '+44 161 276 1001' },
      { name: 'Helen Crawford', role: 'Procurement', phone: '+44 161 276 1002' },
      { name: 'Sarah Jennings', role: 'IT Partner', phone: '+44 161 276 1003' },
    ],
    ...partial,
  }
}

/** Demo schedule seeded by year/month so weekday alignment stays real. */
export function buildMonthEvents(now: Date): AgendaItem[] {
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const today = Math.min(now.getDate(), daysInMonth)
  const clamp = (d: number) => Math.min(Math.max(d, 1), daysInMonth)

  return [
    withDefaults({
      day: clamp(3),
      type: 'visit',
      title: '仁济医院随访',
      time: '10:00',
      location: '黄浦区山东中路145号',
      target: 'detail',
      orgName: '上海仁济医院',
    }),
    withDefaults({
      day: clamp(6),
      type: 'visit',
      title: 'Hospital Alpha 拜访',
      time: '14:30',
      location: 'Pudong New Area, Shanghai',
      target: 'detail',
      orgName: 'Hospital Alpha',
    }),
    withDefaults({
      day: clamp(8),
      type: 'meeting',
      title: '季度管道评审',
      time: '09:30',
      location: 'Online · Teams',
      target: 'detail',
    }),
    withDefaults({
      day: clamp(12),
      type: 'call',
      title: '采购窗口电话确认',
      time: '11:00',
      location: 'Phone · Procurement',
      target: 'detail',
    }),
    withDefaults({
      day: clamp(15),
      type: 'visit',
      title: '客户现场演示',
      time: '15:00',
      location: '徐汇区漕溪北路88号',
      target: 'detail',
    }),
    withDefaults({
      day: clamp(15),
      type: 'email',
      title: '发送报价跟进邮件',
      time: '16:40',
      location: 'Inbox · Follow-up',
      target: 'detail',
    }),
    withDefaults({
      day: clamp(17),
      type: 'visit',
      title: '科室回访',
      time: '09:00',
      location: '静安区南京西路1515号',
      target: 'detail',
    }),
    withDefaults({
      day: clamp(17),
      type: 'email',
      title: '合同条款确认邮件',
      time: '18:00',
      location: 'Inbox · Contracts',
      target: 'detail',
    }),
    withDefaults({
      day: clamp(21),
      type: 'visit',
      title: '新商机摸底',
      time: '13:30',
      location: '闵行区沪闵路6088号',
      target: 'detail',
    }),
    withDefaults({
      day: clamp(21),
      type: 'call',
      title: '售后问题回电',
      time: '16:00',
      location: 'Phone · Support',
      target: 'detail',
    }),
    withDefaults({
      day: clamp(27),
      type: 'meeting',
      title: '周复盘会议',
      time: '10:00',
      location: 'HQ Meeting Room A',
      target: 'detail',
    }),
    withDefaults({
      day: clamp(27),
      type: 'other',
      title: '内部资料整理',
      time: '15:30',
      location: 'CRM Workspace',
      target: 'detail',
    }),
    withDefaults({
      day: today,
      type: 'meeting',
      title: 'Manchester University NHS Foundation Trust - Remote Consultation Platform Demo',
      time: '12:00',
      location: 'Oxford Road, Manchester M13 9WL',
      target: 'detail',
      orgName: 'Manchester University NHS Foundation Trust',
      notes:
        '结果: Held a Teams meeting to demo the remote consultation platform and answered questions',
    }),
    withDefaults({
      day: today,
      type: 'visit',
      title: 'Visit Dr. Joseph - Operation Room',
      time: '10:30',
      location: 'Whitworth Street, Manchester M1 3',
      target: 'detail',
    }),
    withDefaults({
      day: today,
      type: 'visit',
      title: 'Salford Royal Hospital follow-up',
      time: '13:00',
      location: 'Stott Lane, Salford M6 8HD',
      target: 'detail',
      orgName: 'Salford Royal Hospital',
    }),
    withDefaults({
      day: today,
      type: 'call',
      title: 'Call procurement on N17 tender',
      time: '15:00',
      location: 'Phone · Tender desk',
      target: 'detail',
    }),
    withDefaults({
      day: today,
      type: 'visit',
      title: 'Christie Hospital oncology brief',
      time: '17:00',
      location: 'Wilmslow Road, Manchester M20',
      target: 'detail',
      orgName: 'The Christie NHS Foundation Trust',
    }),
  ]
}
