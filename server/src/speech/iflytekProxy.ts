/**
 * 讯飞听写 WebSocket 同源代理：浏览器只连自家 API（CSP 友好），
 * 服务端再鉴权连 iat-api.xfyun.cn。解决 Power Apps 移动端直连讯飞被拦。
 */
import type { Server as HttpServer, IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, WebSocket } from 'ws'
import { hasIFlytek } from '../config.js'
import { buildIFlytekIatAuthUrl } from './iflytek.js'

export const IFLYTEK_IAT_PROXY_PATH = '/api/speech/iat/ws'

function isIatProxyRequest(req: IncomingMessage) {
  const path = (req.url || '').split('?')[0]
  return path === IFLYTEK_IAT_PROXY_PATH
}

export function attachIFlytekIatProxy(server: HttpServer) {
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    if (!isIatProxyRequest(req)) return
    if (!hasIFlytek()) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket as Duplex, head, (client) => {
      pipeClientToIFlytek(client)
    })
  })
}

function pipeClientToIFlytek(client: WebSocket) {
  let upstream: WebSocket | null = null
  let closed = false

  const shutdown = () => {
    if (closed) return
    closed = true
    try {
      if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
        client.close(1000)
      }
    } catch {
      /* ignore */
    }
    try {
      if (
        upstream &&
        (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING)
      ) {
        upstream.close(1000)
      }
    } catch {
      /* ignore */
    }
    upstream = null
  }

  try {
    upstream = new WebSocket(buildIFlytekIatAuthUrl())
  } catch (err) {
    const message = err instanceof Error ? err.message : '讯飞鉴权失败'
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ code: 503, message }))
    }
    shutdown()
    return
  }

  const pending: Array<{ data: WebSocket.RawData; isBinary: boolean }> = []

  upstream.on('open', () => {
    for (const item of pending.splice(0)) {
      if (!upstream || upstream.readyState !== WebSocket.OPEN) break
      try {
        upstream.send(item.data, { binary: item.isBinary })
      } catch {
        shutdown()
        break
      }
    }
  })

  upstream.on('message', (data, isBinary) => {
    if (client.readyState !== WebSocket.OPEN) return
    try {
      client.send(data, { binary: isBinary })
    } catch {
      shutdown()
    }
  })

  upstream.on('error', () => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(JSON.stringify({ code: 502, message: '讯飞上游连接失败' }))
      } catch {
        /* ignore */
      }
    }
    shutdown()
  })

  upstream.on('close', () => shutdown())

  client.on('message', (data, isBinary) => {
    if (!upstream || upstream.readyState === WebSocket.CONNECTING) {
      pending.push({ data, isBinary })
      return
    }
    if (upstream.readyState !== WebSocket.OPEN) return
    try {
      upstream.send(data, { binary: isBinary })
    } catch {
      shutdown()
    }
  })

  client.on('error', () => shutdown())
  client.on('close', () => shutdown())
}
