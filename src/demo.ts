import { broadcastToWebContents, defineHandler, defineSender, registerHandlers } from './main'
import { Type } from './typebox'

const handler1 = defineHandler('handler1', {
  greet(event, data) {
    return `Hello, ${data.name}!`
  },
}, {
  greet: {
    data: Type.Object({ name: Type.String() }),
    return: Type.String(),
  },
})

const handler2 = defineHandler('handler2', {
  ping(_event) {
    return 'pong'
  },
}, {
  ping: {
    data: Type.Undefined(),
    return: Type.String(),
  },
})

const handler3 = defineHandler('handler3', {
  multiply(event, data: { x: number, y: number }) {
    return data.x * data.y
  },
})

registerHandlers(handler1)
  .add(handler3)
  .add(handler2)
  .static
  .handler3
  .multiply({ x: 1, y: 2 })

const createTestSender = defineSender('sender1', {
  hello: Type.String(),
})

broadcastToWebContents(createTestSender).hello('world')
