import { PowerAppV2_________V2_Service } from '../generated/services/PowerAppV2_________V2_Service'
import type { EmailDraftFields } from '../agents/types'

const EMAIL_LIKE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** Max wait for Logic flows + Outlook.com connector via Power Apps host bridge. */
const SEND_TIMEOUT_MS = 120_000

function isPowerAppsHostPresent(): boolean {
  if (typeof window === 'undefined') return false
  const injected = Boolean((globalThis as { powerAppsBridge?: unknown }).powerAppsBridge)
  // Local Play / published Code App embeds the page in a host iframe.
  const inHostFrame = window.parent !== window
  return injected || inHostFrame
}

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(onTimeout()), ms)
    promise.then(
      (value) => {
        window.clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        window.clearTimeout(timer)
        reject(err)
      },
    )
  })
}

function formatFlowError(err: unknown): string {
  if (err instanceof Error && err.message.trim()) return err.message.trim()
  if (typeof err === 'string' && err.trim()) return err.trim()
  if (Array.isArray(err) && err.length) {
    const first = err[0]
    if (typeof first === 'string') return first
    if (first && typeof first === 'object' && 'message' in first) {
      return String((first as { message?: unknown }).message || first)
    }
    try {
      return JSON.stringify(err)
    } catch {
      return String(err)
    }
  }
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message?: unknown }).message || err)
  }
  return '云端流发送失败，请确认 Outlook.com 连接已授权'
}

/** Map UI fields → Power Automate ManualTriggerInput (to / subject / body). */
export async function sendEmailViaPowerAutomate(fields: EmailDraftFields): Promise<void> {
  const to = fields.to.trim()
  const subject = fields.subject.trim()
  const body = fields.body.trim()
  if (!to) throw new Error('请填写收件人')
  if (!EMAIL_LIKE.test(to)) {
    throw new Error('收件人需为有效邮箱地址（例如 name@company.com）')
  }
  if (!subject) throw new Error('请填写主题')
  if (!body) throw new Error('请填写正文')

  if (!isPowerAppsHostPresent()) {
    throw new Error(
      '当前页面不在 Power Apps 宿主中，无法调用 Outlook.com 云端流。请用 Power Apps「本地运行 / Local Play」打开（地址用 localhost，不要用 127.0.0.1），或在已发布的 Code App 内发送。',
    )
  }

  let result: Awaited<ReturnType<typeof PowerAppV2_________V2_Service.Run>>
  try {
    result = await withTimeout(
      PowerAppV2_________V2_Service.Run({
        text: to,
        text_1: subject,
        text_2: body,
      }),
      SEND_TIMEOUT_MS,
      () =>
        new Error(
          `发送超时（超过 ${SEND_TIMEOUT_MS / 1000} 秒仍无响应）。请检查：1) 是否在 Power Apps 宿主中；2) 流「PowerAppV2 -> 发送电子邮件(V2)」已开启；3) Outlook.com 连接引用已授权且可用。`,
        ),
    )
  } catch (err) {
    throw new Error(formatFlowError(err))
  }

  if (!result.success) {
    throw new Error(formatFlowError(result.error))
  }
}
