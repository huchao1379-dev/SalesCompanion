/** Human-readable LLM transport / HTTP failures for steps & degraded_reason. */
export function formatLlmTransportError(error: unknown): string {
  if (!(error instanceof Error)) return 'LLM 调用失败'
  const msg = error.message || error.name || 'unknown'
  const cause =
    error.cause instanceof Error
      ? error.cause
      : error.cause && typeof error.cause === 'object'
        ? (error.cause as { message?: string; code?: string; name?: string })
        : undefined
  const causeMsg =
    cause instanceof Error
      ? cause.message
      : typeof cause?.message === 'string'
        ? cause.message
        : ''
  const code = cause && 'code' in cause ? String(cause.code || '') : ''
  const blob = `${msg} ${causeMsg} ${code}`

  if (/UND_ERR_CONNECT_TIMEOUT|Connect Timeout|connect timeout/i.test(blob)) {
    return '无法连接模型服务（连接超时）。若在国内访问 api.openai.com，请配置可到达的代理或把 OPENAI_BASE_URL 指向网关。'
  }
  if (/ENOTFOUND|getaddrinfo|DNS/i.test(blob)) {
    return '无法解析模型服务域名，请检查网络 / DNS / OPENAI_BASE_URL。'
  }
  if (/ECONNREFUSED|ECONNRESET|network|fetch failed/i.test(blob)) {
    return `模型服务网络不可达：${(causeMsg || msg).slice(0, 120)}`
  }
  if (/aborted|timeout|TimeoutError/i.test(blob)) {
    return '模型请求超时'
  }
  if (/OpenAI HTTP|DeepSeek HTTP|OPENAI_UNAVAILABLE|DEEPSEEK_UNAVAILABLE/i.test(msg)) {
    return msg.slice(0, 160)
  }
  return msg.slice(0, 160)
}

export function wrapLlmFetchError(provider: 'OpenAI' | 'DeepSeek', error: unknown): Error {
  if (error instanceof Error && /HTTP \d+|UNAVAILABLE/.test(error.message)) {
    return error
  }
  const detail = formatLlmTransportError(error)
  const wrapped = new Error(`${provider} ${detail}`)
  if (error instanceof Error) wrapped.cause = error
  return wrapped
}
