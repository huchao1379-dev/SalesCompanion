import { z } from 'zod'

const confidence = z.number().min(0).max(1).optional()

export const intentOutputSchema = z.object({
  intent: z.enum([
    'capture_visit',
    'query_account',
    'query_order',
    'work_summary',
    'general_assist',
    'clarify',
  ]),
  confidence,
  reason: z.string().max(200).optional(),
  needsClarification: z.boolean().optional(),
  missingSlots: z.array(z.string().min(1).max(40)).max(5).optional(),
  focus: z
    .enum(['capability', 'greeting', 'missing_info', 'ambiguous', 'none'])
    .optional(),
})

export const extractVisitOutputSchema = z.object({
  accountName: z.string().nullable().optional(),
  accountId: z.string().nullable().optional(),
  contactName: z.string().nullable().optional(),
  productLine: z.string().nullable().optional(),
  productModel: z.string().nullable().optional(),
  quantity: z.number().int().positive().nullable().optional(),
  unit: z.string().nullable().optional(),
  occurredAt: z.string().nullable().optional(),
  followUpAt: z.string().nullable().optional(),
  followUpHint: z.string().nullable().optional(),
  visitType: z.enum(['Visit', 'Call', 'Demo', 'FollowUp']).optional(),
  summary: z.string().optional(),
  fieldConfidence: z.record(z.string(), z.number().min(0).max(1)).optional(),
  missingFields: z.array(z.string()).max(12).optional(),
  confidence: z.number().min(0).max(1),
})

export const accountProfileOutputSchema = z.object({
  summary: z.string().min(1),
  /** Must be empty or start with 「AI 建议，待核实：」 — never mix into facts. */
  suggestion: z.string().optional(),
  confidence,
  emphasis: z.enum(['credit', 'visits', 'opportunities', 'contacts', 'overview']).optional(),
  unverifiedNotes: z.string().optional(),
})

export const orderQueryOutputSchema = z.object({
  answer: z.string().min(1),
  confidence,
  focus: z.enum(['status', 'eta', 'amount', 'missing']).optional(),
  orderId: z.string().optional(),
  shipmentId: z.string().optional(),
})

export const workSummaryBulletSchema = z.object({
  text: z.string().min(1),
  activityId: z.string().optional(),
  status: z.string().optional(),
})

export const workSummaryOutputSchema = z.object({
  title: z.string().optional(),
  summary: z.string().min(1),
  sections: z
    .array(
      z.object({
        heading: z.string().optional(),
        bullets: z.array(workSummaryBulletSchema).max(10),
      }),
    )
    .max(6)
    .optional(),
  confidence,
})

/** Signal tone for CRM facts vs AI-suggested / risk states. */
export const insightSignalToneSchema = z.enum(['neutral', 'positive', 'pending', 'risk', 'ai'])

export const insightActionPrioritySchema = z.enum(['immediate', 'this_week', 'later'])

export const insightActionTypeSchema = z.enum([
  'follow_up',
  'log_activity',
  'opportunity',
  'meeting',
  'material',
  'other',
])

export const insightSignalSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(40),
  value: z.string().min(1).max(40),
  tone: insightSignalToneSchema.default('neutral'),
  source: z.enum(['activity', 'opportunity', 'visit', 'ai', 'derived']).default('derived'),
})

export const insightPendingCheckSchema = z.object({
  id: z.string().min(1).max(64),
  text: z.string().min(1).max(120),
  source: z
    .enum(['missing_crm_field', 'activity_notes', 'ai', 'opportunity', 'visit'])
    .default('ai'),
})

export const insightActionSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(80),
  description: z.string().max(160).optional().default(''),
  priority: insightActionPrioritySchema.default('this_week'),
  ownerName: z.string().max(80).nullable().optional().default(null),
  contactName: z.string().max(80).nullable().optional().default(null),
  dueAt: z.string().nullable().optional().default(null),
  dueLabel: z.string().max(40).nullable().optional().default(null),
  source: z.string().max(80).optional().default('activity_notes'),
  actionType: insightActionTypeSchema.optional().default('follow_up'),
})

export const insightEvidenceSchema = z.object({
  activityIncluded: z.boolean().default(true),
  opportunityCount: z.number().int().min(0).default(0),
  recentVisitCount: z.number().int().min(0).default(0),
  crmUpdatedAt: z.string().nullable().optional().default(null),
})

/**
 * Fields the LLM is allowed to generate.
 * CRM facts (signals / evidence) are assembled on the server and must not be overridden.
 */
export const activityInsightLlmOutputSchema = z.object({
  summary: z.string().min(1).max(400),
  /** Optional structured feedback tone — never inferred by regex from free text elsewhere. */
  feedbackTone: z.enum(['positive', 'neutral', 'risk']).nullable().optional(),
  pendingChecks: z.array(insightPendingCheckSchema).max(6).optional().default([]),
  actions: z.array(insightActionSchema).min(3).max(5),
  /** Internal diagnostics only — not shown in UI. */
  confidence,
})

/** Full API response after server merges CRM facts + AI fields. */
export const activityInsightOutputSchema = z.object({
  summary: z.string().min(1).max(400),
  signals: z.array(insightSignalSchema).max(5).default([]),
  pendingChecks: z.array(insightPendingCheckSchema).max(6).default([]),
  actions: z.array(insightActionSchema).max(5).default([]),
  evidence: insightEvidenceSchema,
  updatedAt: z.string().min(1),
  mode: z.enum(['deepseek', 'heuristic', 'copilotstudio']),
  agentName: z.string().min(1).default('活动洞察 Agent'),
  /** @deprecated Prefer evidence.*; kept for brief compatibility. */
  opportunityCount: z.number().int().min(0).optional(),
  visitCount: z.number().int().min(0).optional(),
  /** Internal only — clients must not render as win probability. */
  confidence: z.number().min(0).max(1).optional(),
})

/** Opportunity detail AI insight — LLM may only fill the same narrative fields as activity. */
export const opportunityInsightLlmOutputSchema = activityInsightLlmOutputSchema

export const opportunityInsightEvidenceSchema = z.object({
  opportunityIncluded: z.boolean().default(true),
  recentVisitCount: z.number().int().min(0).default(0),
  missingFieldCount: z.number().int().min(0).default(0),
  crmUpdatedAt: z.string().nullable().optional().default(null),
})

export const opportunityInsightOutputSchema = z.object({
  summary: z.string().min(1).max(400),
  signals: z.array(insightSignalSchema).max(5).default([]),
  pendingChecks: z.array(insightPendingCheckSchema).max(6).default([]),
  actions: z.array(insightActionSchema).max(5).default([]),
  evidence: opportunityInsightEvidenceSchema,
  updatedAt: z.string().min(1),
  mode: z.enum(['deepseek', 'heuristic', 'copilotstudio']),
  agentName: z.string().min(1).default('商机洞察 Agent'),
  visitCount: z.number().int().min(0).optional(),
  missingFieldCount: z.number().int().min(0).optional(),
  /** Internal only — clients must not render as win probability. */
  confidence: z.number().min(0).max(1).optional(),
})

export const clarifyOutputSchema = z.object({
  reply: z.string().min(1),
  question: z.string().optional(),
  confidence,
  focus: z.enum(['capability', 'greeting', 'missing_info', 'other']).optional(),
  examples: z.array(z.string().min(1)).max(3).optional(),
})

export const generalAssistOutputSchema = z.object({
  answer: z.string().min(1),
  title: z.string().optional(),
  sections: z
    .array(
      z.object({
        heading: z.string().optional(),
        bullets: z
          .array(
            z.object({
              text: z.string().min(1),
              activityId: z.string().optional(),
              status: z.string().optional(),
            }),
          )
          .min(1)
          .max(8),
      }),
    )
    .max(4)
    .optional(),
  followUps: z.array(z.string().min(1).max(80)).max(4).optional(),
  confidence,
  usedWeb: z.boolean().optional(),
  sources: z
    .array(
      z.object({
        label: z.string().min(1),
        url: z.string().optional(),
      }),
    )
    .max(6)
    .optional(),
})

export const searchAccountsArgsSchema = z.object({
  query: z.string().min(1).max(200),
})

export const accountIdArgsSchema = z.object({
  accountId: z.string().min(1).max(100),
})
