import * as electron from 'electron'
import { ipcRenderer } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { formatSenderName, TYPE_IPC_EXPOSE_NAME, TYPE_IPC_HANDLER_NAME } from '../src/common'
import { exposeTypeIpc } from '../src/preload'

describe('exposeTypeIpc', () => {
  it('should expose invoke and message in window', () => {
    const exposeMock = vi.spyOn(electron.contextBridge, 'exposeInMainWorld')
    vi.mock('electron', () => ({
      contextBridge: {
        exposeInMainWorld: vi.fn(),
      },
      ipcRenderer: {
        invoke: vi.fn(),
        on: vi.fn(),
        removeListener: vi.fn(),
      },
    }))

    exposeTypeIpc()

    expect(exposeMock).toHaveBeenCalledWith(
      TYPE_IPC_EXPOSE_NAME,
      expect.objectContaining({
        invoke: expect.any(Function),
        message: expect.any(Function),
      }),
    )

    // test invoke
    const invokeFunc = exposeMock.mock.calls[0][1].invoke
    const testData = { name: 'test', method: 'hello', data: 123 }
    invokeFunc(testData)
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(TYPE_IPC_HANDLER_NAME, testData)

    // test message
    const messageFunc = exposeMock.mock.calls[0][1].message
    const callback = vi.fn()
    const off = messageFunc({ name: 'test', method: 'onhello', callback })
    expect(ipcRenderer.on).toHaveBeenCalledWith(
      formatSenderName('test', 'hello'),
      expect.any(Function),
    )
    // test return removeListener
    off()
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Function),
    )
  })
})
