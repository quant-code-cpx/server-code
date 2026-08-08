'use strict'

const http = require('node:http')
const net = require('node:net')

const proxies = new Map([
  ['database', createProxy('database', 15432, process.env.NEWS_FAULT_DATABASE_TARGET || 'database:5432')],
  ['redis', createProxy('redis', 16379, process.env.NEWS_FAULT_REDIS_TARGET || 'news-fault-redis:6379')],
])

function createProxy(name, port, targetValue) {
  const target = parseTarget(targetValue)
  const state = { name, port, target, enabled: true, sockets: new Set() }
  const server = net.createServer((downstream) => {
    if (!state.enabled) {
      downstream.destroy()
      return
    }
    const upstream = net.createConnection({ host: target.host, port: target.port })
    state.sockets.add(downstream)
    state.sockets.add(upstream)
    const cleanup = () => {
      state.sockets.delete(downstream)
      state.sockets.delete(upstream)
    }
    downstream.once('close', cleanup)
    upstream.once('close', cleanup)
    downstream.once('error', () => upstream.destroy())
    upstream.once('error', () => downstream.destroy())
    downstream.pipe(upstream)
    upstream.pipe(downstream)
  })
  server.listen(port, '0.0.0.0')
  state.server = server
  return state
}

const control = http.createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    return json(response, 200, { status: 'ok', proxies: [...proxies.keys()] })
  }
  const match = request.url && request.url.match(/^\/proxies\/(database|redis)\/(enable|disable)$/)
  if (request.method !== 'POST' || !match) return json(response, 404, { error: 'not_found' })
  const state = proxies.get(match[1])
  state.enabled = match[2] === 'enable'
  if (!state.enabled) {
    for (const socket of state.sockets) socket.destroy()
    state.sockets.clear()
  }
  return json(response, 200, { proxy: state.name, enabled: state.enabled })
})
control.listen(8474, '0.0.0.0')

function parseTarget(value) {
  const match = value.match(/^([a-zA-Z0-9_-]+):(\d{1,5})$/)
  if (!match) throw new Error('fault proxy target 非法')
  const port = Number(match[2])
  if (port < 1 || port > 65535) throw new Error('fault proxy target port 非法')
  return { host: match[1], port }
}

function json(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
  response.end(body)
}

function shutdown() {
  control.close()
  for (const state of proxies.values()) {
    for (const socket of state.sockets) socket.destroy()
    state.server.close()
  }
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
