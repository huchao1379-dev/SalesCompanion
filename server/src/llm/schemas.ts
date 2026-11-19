import { z } from 'zod'

const confidence = z.number().min(0).max(1).optional()

export const intentOutputSchema = z.object({
  intent: z.enum(['capture_visit', 'query_account', 'query_order', 'work_summary', 'clarify']),
  confidence,
  reason: z.string().max(100).optional(),
})

export const extractVisitOutputSchema = z.object({
  accountName: z.string().nullable().optional(),
  contactName: z.string().nullable().optional(),
  productLine: z.string().nullable().optional(),
  productModel: z.string().nullable().optional(),
  quantity: z.number().int().positive().nullable().optional(),
  followUpHint: z.string().nullable().optional(),
  visitType: z.enum(['Visit', 'Call', 'Demo', 'FollowUp']).optional(),
  summary: z.string().optional(),
  confidence: z.number().min(0).max(1),
})

export const accountProfileOutputSchema = z.object({
  summary: z.string().min(1),
  /** Must be empty or start with 「AI 建议，待核实：」 — never mix into facts. */
  suggestion: z.string().optional(),
  confidence,
  emphasis: z.enum(['credit', 'visits', 'opportunities', 'contacts', 'overview']).optional(),
})

export const orderQueryOutputSchema = z.object({
  answer: z.string().min(1),
  confidence,
  focus: z.enum(['status', 'eta', 'amount', 'missing']).optional(),
})

export const workSummaryOutputSchema = z.object({
  summary: z.string().min(1),
  confidence,
})

export const clarifyOutputSchema = z.object({
  reply: z.string().min(1),
  confidence,
  focus: z.enum(['capability', 'greeting', 'missing_info', 'other']).optional(),
  examples: z.array(z.string().min(1)).max(3).optional(),
})

export const searchAccountsArgsSchema = z.object({
  query: z.string().min(1).max(200),
})

export const accountIdArgsSchema = z.object({
  accountId: z.string().min(1).max(100),
})
