import { Type } from '@sinclair/typebox'
import { webContents } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TYPE_IPC_SENDER_NAME } from '../src/common'
import { broadcastToWebContents, defineSender } from '../src/main/sender'

// Mock electron
vi.mock('electron', () => {
  return {
    webContents: {
      getAllWebContents: vi.fn().mockReturnValue([
        { send: vi.fn() },
        { send: vi.fn() },
      ]),
    },
  }
})

describe('defineSender', () => {
  it('should create a sender and send data', () => {
    const createSender = defineSender('TestSender', { hello: Type.String() })
    const mockWindow = { webContents: { send: vi.fn() } }

    const sender = createSender(mockWindow.webContents)
    sender.hello('world')

    expect(mockWindow.webContents.send)
      .toHaveBeenCalledWith(
        TYPE_IPC_SENDER_NAME,
        {
          name: 'TestSender',
          method: 'hello',
          data: 'world',
        },
      )
  })

  it('should cache sender per window', () => {
    const createSender = defineSender('TestSender', { hello: Type.String() })
    const mockWindow = { webContents: { send: vi.fn() } }

    const sender1 = createSender(mockWindow.webContents)
    const sender2 = createSender(mockWindow.webContents)

    expect(sender1).toBe(sender2)
  })

  it('should send data correctly when validate=true', () => {
    const createSender = defineSender('TestSender', { hello: Type.String() }, { validate: true })
    const mockWindow = { webContents: { send: vi.fn() } } as any
    const sender = createSender(mockWindow.webContents)

    sender.hello('world')

    expect(mockWindow.webContents.send).toHaveBeenCalledWith(
      TYPE_IPC_SENDER_NAME,
      {
        name: 'TestSender',
        method: 'hello',
        data: 'world',
      },
    )
  })

  it('should throw error when data does not match schema', () => {
    const createSender = defineSender('TestSender', { hello: Type.String() }, { validate: true })
    const mockWindow = { webContents: { send: vi.fn() } } as any
    const sender = createSender(mockWindow)

    expect(() => sender.hello({} as any)).toThrow()
    expect(mockWindow.webContents.send).not.toHaveBeenCalled()
  })
})

describe('broadcastToWebContents', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('should only broadcast to the provided webContents', () => {
    const createSender = defineSender('TestSender', { hello: Type.String() })
    const mockWindow1 = { webContents: { send: vi.fn() } }
    const mockWindow2 = { webContents: { send: vi.fn() } }

    const sender = broadcastToWebContents(createSender, [
      mockWindow1.webContents,
      mockWindow2.webContents,
    ])

    sender.hello('world')

    expect(mockWindow1.webContents.send).toHaveBeenCalledWith(TYPE_IPC_SENDER_NAME, {
      name: 'TestSender',
      method: 'hello',
      data: 'world',
    })
    expect(mockWindow2.webContents.send).toHaveBeenCalledWith(TYPE_IPC_SENDER_NAME, {
      name: 'TestSender',
      method: 'hello',
      data: 'world',
    })
  })

  it('should broadcast to all webContents when no list is provided', () => {
    const createSender = defineSender('AutoSender', { ping: Type.String() })

    const sender = broadcastToWebContents(createSender)

    sender.ping('pong')

    const mockWindowA = webContents.getAllWebContents()[0]
    const mockWindowB = webContents.getAllWebContents()[1]

    expect(mockWindowA.send).toHaveBeenCalledWith(TYPE_IPC_SENDER_NAME, {
      name: 'AutoSender',
      method: 'ping',
      data: 'pong',
    })
    expect(mockWindowB.send).toHaveBeenCalledWith(TYPE_IPC_SENDER_NAME, {
      name: 'AutoSender',
      method: 'ping',
      data: 'pong',
    })
  })
})
