import { config, hasVisionModel } from '../config.js'
import type { OrchestratorAttachment } from '../types.js'

const MAX_ATTACHMENTS = 5
const MAX_BYTES_EACH = 10 * 1024 * 1024
const MAX_TEXT_CHARS = 6000
const MAX_VISION_CHARS = 1200

export type AttachmentUnderstanding = {
  /** Merged into the user utterance for downstream agents. */
  contextBlock: string
  /** True when at least one image could not be visually understood. */
  visionDegraded: boolean
  summaries: string[]
}

function stripDataUrl(dataBase64: string) {
  const trimmed = dataBase64.trim()
  const comma = trimmed.indexOf(',')
  if (trimmed.startsWith('data:') && comma >= 0) return trimmed.slice(comma + 1)
  return trimmed
}

function byteLength(b64: string) {
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding)
}

function isImage(mime: string) {
  return mime.startsWith('image/')
}

function isTextLike(mime: string, name: string) {
  if (mime.startsWith('text/')) return true
  if (mime === 'application/json' || mime === 'application/csv') return true
  return /\.(txt|md|csv|json|log)$/i.test(name)
}

function decodeText(b64: string) {
  try {
    const raw = Buffer.from(b64, 'base64').toString('utf8')
    return raw.replace(/\u0000/g, '').slice(0, MAX_TEXT_CHARS)
  } catch {
    return ''
  }
}

async function describeImage(att: OrchestratorAttachment, b64: string): Promise<string> {
  if (!hasVisionModel()) {
    return '（当前未配置 VISION_MODEL，无法识别图片像素；请在文字里说明图片内容，或配置视觉模型后重试。）'
  }

  const dataUrl = `data:${att.mimeType || 'image/jpeg'};base64,${b64}`
  const res = await fetch(`${config.visionBaseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.visionApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.visionModel,
      temperature: 0.1,
      max_tokens: 500,
      messages: [
        {
          role: 'system',
          content:
            '你是销售助手的附件理解模块。用中文简洁描述图片中与销售/CRM 相关的信息（客户名、联系人、产品、数量、日期、订单号等）。不要编造看不清的内容；看不清就写「无法辨认」。',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: `请理解附件「${att.name}」，提取对跟进有用的要点。` },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(20_000),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Vision HTTP ${res.status}: ${body.slice(0, 160)}`)
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>
  }
  const content = json.choices?.[0]?.message?.content
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.map((part) => part.text || '').join('')
        : ''
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (!cleaned) throw new Error('Vision returned empty content')
  return cleaned.slice(0, MAX_VISION_CHARS)
}

/**
 * Turn raw attachments into text context that text-only agents can consume.
 * Images require VISION_MODEL; text files are inlined.
 */
export async function understandAttachments(
  attachments: OrchestratorAttachment[] | undefined,
): Promise<AttachmentUnderstanding> {
  const list = (attachments || []).slice(0, MAX_ATTACHMENTS)
  if (!list.length) {
    return { contextBlock: '', visionDegraded: false, summaries: [] }
  }

  const summaries: string[] = []
  let visionDegraded = false

  for (const att of list) {
    const name = (att.name || '未命名附件').slice(0, 120)
    const mime = (att.mimeType || 'application/octet-stream').slice(0, 80)
    const b64 = stripDataUrl(att.dataBase64 || '')
    if (!b64) {
      summaries.push(`- ${name}（${mime}）：内容为空，已忽略`)
      continue
    }
    if (byteLength(b64) > MAX_BYTES_EACH) {
      summaries.push(`- ${name}（${mime}）：超过 10MB，已忽略`)
      continue
    }

    if (isTextLike(mime, name)) {
      const text = decodeText(b64)
      summaries.push(
        text
          ? `- ${name}（文本）：\n${text}`
          : `- ${name}（文本）：无法解码为 UTF-8 文本`,
      )
      continue
    }

    if (isImage(mime)) {
      try {
        const description = await describeImage(att, b64)
        if (!hasVisionModel()) visionDegraded = true
        summaries.push(`- ${name}（图片）：${description}`)
      } catch (error) {
        visionDegraded = true
        const detail = error instanceof Error ? error.message.slice(0, 120) : 'unknown'
        summaries.push(`- ${name}（图片）：识别失败（${detail}）。请改用文字说明图片内容。`)
      }
      continue
    }

    summaries.push(
      `- ${name}（${mime}）：二进制附件暂不解析内容，仅记录文件名；请用文字补充要点。`,
    )
  }

  const contextBlock = [
    '【附件理解】以下内容由系统从用户上传的附件提取，供你结合用户原话处理：',
    ...summaries,
  ].join('\n')

  return { contextBlock, visionDegraded, summaries }
}

export function mergeUtteranceWithAttachments(utterance: string, understanding: AttachmentUnderstanding) {
  const text = utterance.trim()
  if (!understanding.contextBlock) return text
  if (!text) {
    return `${understanding.contextBlock}\n\n请根据以上附件内容协助处理。`
  }
  return `${understanding.contextBlock}\n\n【用户原话】\n${text}`
}
