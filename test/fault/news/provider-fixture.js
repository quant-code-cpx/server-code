'use strict'

const { createHash } = require('node:crypto')
const http = require('node:http')

const token = process.env.NEWS_FAULT_BRIDGE_TOKEN || ''
if (Buffer.byteLength(token) < 32) throw new Error('NEWS_FAULT_BRIDGE_TOKEN 至少 32 字节')
const delayMs = Number(process.env.NEWS_FAULT_BRIDGE_DELAY_MS || 120000)
let mode = 'success'
let sequence = []
let fixtureId = 'baseline'
let requestCount = 0

const server = http.createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/healthz') return json(response, 200, { status: 'ok' })
  if (request.method === 'POST' && request.url === '/__control') {
    const body = await readJson(request)
    if (typeof body.mode === 'string') mode = body.mode
    if (Array.isArray(body.sequence)) sequence = body.sequence.filter((value) => typeof value === 'string')
    if (typeof body.fixtureId === 'string' && /^[a-z0-9-]{1,40}$/.test(body.fixtureId)) fixtureId = body.fixtureId
    return json(response, 200, { mode, sequenceLength: sequence.length, fixtureId, requestCount })
  }
  if (request.method !== 'POST' || !request.url?.startsWith('/v1/')) return json(response, 404, { error: 'not_found' })
  if (request.headers.authorization !== `Bearer ${token}`) return json(response, 401, { error: 'unauthorized' })
  await readJson(request)
  requestCount += 1
  const selected = sequence.length ? sequence.shift() : mode
  if (selected === '429') {
    response.setHeader('retry-after', '1')
    return json(response, 429, { error: 'rate_limited' })
  }
  if (selected === '502') return json(response, 502, { error: 'upstream_unavailable' })
  if (selected === 'timeout') {
    setTimeout(
      () => {
        if (!response.destroyed) json(response, 200, envelope())
      },
      Math.max(delayMs, 10_000),
    )
    return
  }
  if (selected === 'delay-success') {
    setTimeout(() => {
      if (!response.destroyed) json(response, 200, envelope())
    }, delayMs)
    return
  }
  return json(response, 200, envelope())
})
server.listen(8080, '0.0.0.0')

function envelope() {
  const now = new Date().toISOString()
  const upstreamId = `news-fault-${fixtureId}`
  return {
    schemaVersion: 1,
    requestId: `fault-request-${requestCount}`,
    retrievedAt: now,
    items: [
      {
        upstreamId,
        contentType: 'NEWS',
        title: `故障注入合成新闻 ${fixtureId}`,
        excerpt: '仅用于隔离故障恢复验证',
        publisher: 'NEWS_FAULT_FIXTURE',
        canonicalUrl: `https://news-fault.invalid/${fixtureId}`,
        alternateUrls: [],
        publishedAt: now,
        publishedDate: null,
        publishedPrecision: 'SECOND',
        sourceDiscoveredAt: now,
        language: 'zh-CN',
        sourceCountry: 'CN',
        securityHints: [],
        category: 'FAULT_TEST',
        sourceMetadata: { fixture: true },
        rawPayloadHash: createHash('sha256').update(upstreamId).digest('hex'),
        qualityFlags: [],
      },
    ],
    warnings: [],
  }
}

async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 1_000_000) throw new Error('request_too_large')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return {}
  }
}

function json(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
  response.end(body)
}

function shutdown() {
  server.close()
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
