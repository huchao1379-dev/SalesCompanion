import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { describe, it } from 'node:test'
import { buildIFlytekIatAuthUrl } from '../src/speech/iflytek.js'

describe('iflytek iat auth url', () => {
  it('builds wss url with authorization, date, host', () => {
    const url = buildIFlytekIatAuthUrl({
      apiKey: 'keyxxxxxxxx8ee279348519exxxxxxxx',
      apiSecret: 'secretxxxxxxxx2df7900c09xxxxxxxx',
    })
    assert.match(url, /^wss:\/\/iat-api\.xfyun\.cn\/v2\/iat\?/)
    // 官方示例 date 用 %20，避免 URLSearchParams 的 +
    assert.match(url, /date=[^&]*%20/)
    assert.doesNotMatch(url, /date=[^&]*\+/)
    const parsed = new URL(url)
    assert.equal(parsed.searchParams.get('host'), 'iat-api.xfyun.cn')
    assert.ok(parsed.searchParams.get('date'))
    assert.ok(parsed.searchParams.get('authorization'))
    // authorization is base64 of api_key=... signature=...
    const auth = Buffer.from(parsed.searchParams.get('authorization') || '', 'base64').toString(
      'utf8',
    )
    assert.match(auth, /api_key="keyxxxxxxxx8ee279348519exxxxxxxx"/)
    assert.match(auth, /algorithm="hmac-sha256"/)
    assert.match(auth, /signature="/)
  })

  it('matches official doc HMAC example', () => {
    const signatureOrigin = [
      'host: iat-api.xfyun.cn',
      'date: Wed, 10 Jul 2019 07:35:43 GMT',
      'GET /v2/iat HTTP/1.1',
    ].join('\n')
    const signature = crypto
      .createHmac('sha256', 'secretxxxxxxxx2df7900c09xxxxxxxx')
      .update(signatureOrigin)
      .digest('base64')
    assert.equal(signature, 'Hp3Ty4ZkSBmL8jKyOLpQiv9Sr5nvmeYEH7WsL/ZO2Jg=')
  })
})
