import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  formatGeneralAssistError,
  heuristicAssist,
} from '../src/agents/generalAssist.agent.js'

describe('general assist fallback templates', () => {
  it('routes hot-topic + 开场 questions to industry topics, not sales script', () => {
    const result = heuristicAssist(
      '帮我整理 3 条适合跟医院客户开场聊的医疗行业热点话题',
      'Hospital Beta',
    )
    assert.equal(result.title, '行业话题备忘')
    assert.match(result.answer, /3 个可跟医院客户开场聊/)
    assert.ok(result.sections.some((s) => s.heading?.includes('3 条')))
  })

  it('still uses speech template for explicit 话术 / 开场话术', () => {
    const script = heuristicAssist('监护仪开场话术怎么讲')
    assert.equal(script.title, '拜访话术要点')

    const pitch = heuristicAssist('N17 卖点怎么讲')
    assert.equal(pitch.title, '拜访话术要点')
  })

  it('returns structured emailDraft for follow-up mail requests', () => {
    const mail = heuristicAssist('帮我写一封拜访后的跟进邮件', '仁济医院')
    assert.equal(mail.title, '跟进邮件草稿')
    assert.ok(mail.emailDraft)
    assert.match(mail.emailDraft!.subject, /沟通|仁济/)
    assert.ok(mail.emailDraft!.body.length > 20)

    const alt = heuristicAssist('帮我写一份跟进邮件')
    assert.ok(alt.emailDraft?.subject)
    assert.ok(alt.emailDraft?.body)
  })

  it('formats timeout and parse errors for steps/logs', () => {
    const timeout = new Error('The operation was aborted due to timeout')
    timeout.name = 'TimeoutError'
    assert.equal(formatGeneralAssistError(timeout), 'LLM/工具请求超时')

    assert.match(
      formatGeneralAssistError(new Error('No JSON object in model output')),
      /模型输出 JSON 语法错误/,
    )
    assert.match(
      formatGeneralAssistError(new Error('DeepSeek HTTP 429: rate limit')),
      /DeepSeek HTTP 429/,
    )
  })
})
