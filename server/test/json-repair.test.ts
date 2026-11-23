import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { z } from 'zod'
import { parseJsonLenient, softenJsonText } from '../src/llm/jsonRepair.js'
import { parseStructuredJson } from '../src/llm/deepseek.js'
import { parseAssistJson, formatGeneralAssistError } from '../src/agents/generalAssist.agent.js'
import { generalAssistOutputSchema } from '../src/llm/schemas.js'

describe('jsonRepair', () => {
  it('parses trailing commas and fences', () => {
    const raw = '```json\n{"answer":"ok","items":[1,2,],}\n```'
    assert.deepEqual(parseJsonLenient(raw), { answer: 'ok', items: [1, 2] })
  })

  it('escapes unescaped quotes inside Chinese prose strings', () => {
    // Mirrors the production failure: quote inside a bullet breaks the array.
    const broken = `{
  "answer": "给你三条热点",
  "title": "行业话题",
  "sections": [{
    "heading": "要点",
    "bullets": [
      {"text": "集采窗口：问对方"今年目录"有没有动"},
      {"text": "报警疲劳与联网"}
    ]
  }],
  "confidence": 0.8
}`
    const parsed = parseJsonLenient(broken) as {
      sections: Array<{ bullets: Array<{ text: string }> }>
    }
    assert.match(parsed.sections[0]!.bullets[0]!.text, /今年目录/)
    assert.equal(parsed.sections[0]!.bullets.length, 2)
  })

  it('parseStructuredJson validates after repair', () => {
    const schema = z.object({ answer: z.string(), confidence: z.number() })
    const data = parseStructuredJson(
      '前言\n{"answer":"你好","confidence":0.9,}\n后缀',
      schema,
    )
    assert.deepEqual(data, { answer: '你好', confidence: 0.9 })
  })

  it('parseAssistJson accepts repaired general_assist payload', () => {
    const broken = `{
  "answer": "框架如下",
  "title": "行业话题备忘",
  "sections": [{"heading":"3 条","bullets":[{"text":"先问"集采"节奏"}]}],
  "followUps": ["写开场白"],
  "confidence": 0.7,
  "usedWeb": false
}`
    const data = parseAssistJson(broken)
    assert.equal(data.title, '行业话题备忘')
    assert.match(data.sections![0]!.bullets[0]!.text, /集采/)
    generalAssistOutputSchema.parse(data)
  })

  it('softenJsonText normalizes smart quotes', () => {
    const softened = softenJsonText('{"answer":“你好”}')
    assert.equal(JSON.parse(softened).answer, '你好')
  })

  it('formatGeneralAssistError classifies JSON syntax errors', () => {
    assert.match(
      formatGeneralAssistError(
        new Error(`Expected ',' or ']' after array element in JSON at position 1653`),
      ),
      /JSON 语法错误/,
    )
  })
})
