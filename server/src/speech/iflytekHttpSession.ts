/**
 * 讯飞听写 HTTPS 会话代理：浏览器用 fetch/SSE（走已放行的 https connect-src），
 * 服务端再开 WSS 连讯飞。避免 Power Apps CSP 未放行 wss://你的API 时失败。
 */
import { randomUUID } from 'node:crypto'
import type { Request, Response, Router } from 'express'
import { WebSocket, type RawData } from 'ws'
import { hasIFlytek } from '../config.js'
import { buildIFlytekIatAuthUrl } from './iflytek.js'

type SseClient = {
  res: Response
  write: (payload: unknown) => void
}

type IatHttpSession = {
  id: string
  upstream: WebSocket
  pending: Array<RawData | string>
  sse: Set<SseClient>
  createdAt: number
  closed: boolean
}

const sessions = new Map<string, IatHttpSession>()
const SESSION_TTL_MS = 5 * 60 * 1000

function sweepExpired() {
  const now = Date.now()
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) closeSession(session)
    else if (session.closed) sessions.delete(id)
  }
}

setInterval(sweepExpired, 60_000).unref?.()

function broadcast(session: IatHttpSession, payload: unknown) {
  for (const client of [...session.sse]) {
    try {
      client.write(payload)
    } catch {
      session.sse.delete(client)
    }
  }
}

function closeSession(session: IatHttpSession) {
  if (session.closed) {
    sessions.delete(session.id)
    return
  }
  session.closed = true
  try {
    if (
      session.upstream.readyState === WebSocket.OPEN ||
      session.upstream.readyState === WebSocket.CONNECTING
    ) {
      session.upstream.close(1000)
    }
  } catch {
    /* ignore */
  }
  for (const client of session.sse) {
    try {
      client.res.end()
    } catch {
      /* ignore */
    }
  }
  session.sse.clear()
  sessions.delete(session.id)
}

function flushPending(session: IatHttpSession) {
  if (session.upstream.readyState !== WebSocket.OPEN) return
  for (const raw of session.pending.splice(0)) {
    try {
      session.upstream.send(raw)
    } catch {
      closeSession(session)
      return
    }
  }
}

function createSession(): IatHttpSession {
  const id = randomUUID()
  const upstream = new WebSocket(buildIFlytekIatAuthUrl())
  const session: IatHttpSession = {
    id,
    upstream,
    pending: [],
    sse: new Set(),
    createdAt: Date.now(),
    closed: false,
  }

  upstream.on('open', () => flushPending(session))
  upstream.on('message', (data: RawData, isBinary: boolean) => {
    let text: string
    if (typeof data === 'string') text = data
    else if (Buffer.isBuffer(data)) text = data.toString('utf8')
    else if (Array.isArray(data)) text = Buffer.concat(data).toString('utf8')
    else text = Buffer.from(data).toString('utf8')

    if (isBinary) {
      broadcast(session, { code: 0, binary: true })
      return
    }
    try {
      broadcast(session, JSON.parse(text))
    } catch {
      broadcast(session, { code: 0, raw: text })
    }
  })
  upstream.on('error', () => {
    broadcast(session, { code: 502, message: '讯飞上游连接失败' })
    closeSession(session)
  })
  upstream.on('close', () => {
    broadcast(session, { code: 0, data: { status: 2 }, proxyClosed: true })
    closeSession(session)
  })

  sessions.set(id, session)
  return session
}

function getSession(id: string) {
  const session = sessions.get(id)
  if (!session || session.closed) return null
  return session
}

function sendUpstream(session: IatHttpSession, body: unknown) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body)
  if (session.upstream.readyState === WebSocket.CONNECTING) {
    session.pending.push(raw)
    return
  }
  if (session.upstream.readyState !== WebSocket.OPEN) {
    throw new Error('讯飞会话已关闭')
  }
  session.upstream.send(raw)
}

export function mountIFlytekHttpSessionRoutes(router: Router) {
  router.post('/speech/iat/session', (_req: Request, res: Response) => {
    if (!hasIFlytek()) {
      res.status(503).json({ error: '讯飞语音未配置' })
      return
    }
    try {
      const session = createSession()
      res.status(201).json({
        sessionId: session.id,
        transport: 'http',
        eventsPath: `/speech/iat/session/${session.id}/events`,
        audioPath: `/speech/iat/session/${session.id}/audio`,
      })
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : '创建讯飞会话失败',
      })
    }
  })

  router.get('/speech/iat/session/:id/events', (req: Request, res: Response) => {
    const session = getSession(String(req.params.id || ''))
    if (!session) {
      res.status(404).json({ error: '会话不存在或已结束' })
      return
    }

    res.status(200)
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders?.()

    const client: SseClient = {
      res,
      write: (payload) => {
        res.write(`data: ${JSON.stringify(payload)}\n\n`)
      },
    }
    session.sse.add(client)
    client.write({ code: 0, ready: true })

    const heartbeat = setInterval(() => {
      try {
        res.write(`: ping\n\n`)
      } catch {
        clearInterval(heartbeat)
      }
    }, 15000)
    heartbeat.unref?.()

    req.on('close', () => {
      clearInterval(heartbeat)
      session.sse.delete(client)
    })
  })

  router.post('/speech/iat/session/:id/audio', (req: Request, res: Response) => {
    const session = getSession(String(req.params.id || ''))
    if (!session) {
      res.status(404).json({ error: '会话不存在或已结束' })
      return
    }
    try {
      sendUpstream(session, req.body)
      res.status(204).end()
    } catch (error) {
      res.status(502).json({
        error: error instanceof Error ? error.message : '转发音频失败',
      })
    }
  })

  router.delete('/speech/iat/session/:id', (req: Request, res: Response) => {
    const session = getSession(String(req.params.id || ''))
    if (session) closeSession(session)
    res.status(204).end()
  })
}
