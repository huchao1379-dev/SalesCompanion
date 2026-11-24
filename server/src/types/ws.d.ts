/**
 * Local typings for `ws` under moduleResolution NodeNext.
 * Keeps `tsc` working even when `@types/ws` is missing from the install.
 */
declare module 'ws' {
  import type { IncomingMessage } from 'node:http'
  import type { Duplex } from 'node:stream'
  import { EventEmitter } from 'node:events'

  export type RawData = Buffer | ArrayBuffer | Buffer[]

  export class WebSocket extends EventEmitter {
    static readonly CONNECTING: 0
    static readonly OPEN: 1
    static readonly CLOSING: 2
    static readonly CLOSED: 3
    readonly readyState: 0 | 1 | 2 | 3
    constructor(address: string | URL)
    send(data: RawData | string, options?: { binary?: boolean }): void
    close(code?: number, reason?: string): void
    on(event: 'open', listener: () => void): this
    on(event: 'message', listener: (data: RawData, isBinary: boolean) => void): this
    on(event: 'error', listener: (err: Error) => void): this
    on(event: 'close', listener: () => void): this
    once(event: 'open', listener: () => void): this
  }

  export class WebSocketServer extends EventEmitter {
    constructor(options?: { noServer?: boolean })
    handleUpgrade(
      request: IncomingMessage,
      socket: Duplex,
      head: Buffer,
      callback: (client: WebSocket) => void,
    ): void
  }
}
