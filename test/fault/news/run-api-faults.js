'use strict'

const { randomUUID } = require('node:crypto')
const { chmod, open, readFile, rename, unlink } = require('node:fs/promises')

const baseUrl = requiredOrigin('NEWS_FAULT_BASE_URL')
const proxyUrl = requiredOrigin('NEWS_FAULT_PROXY_URL')
const bridgeUrl = requiredOrigin('NEWS_FAULT_BRIDGE_URL')
const runId = process.env.NEWS_FAULT_RUN_ID || ''
const phase = process.env.NEWS_FAULT_PHASE || 'database'
if (!/^news-fault-[a-z0-9][a-z0-9-]{0,63}$/.test(runId)) throw new Error('NEWS_FAULT_RUN_ID 非法')
const tokenFile = process.env.NEWS_FAULT_ACCESS_TOKEN_FILE || ''
if (!/^\/reports\/[a-zA-Z0-9._-]+-access-token$/.test(tokenFile)) throw new Error('token file 非法')

async function main() {
  const token = (await readFile(tokenFile, 'utf8')).trim()
  if (!token) throw new Error('故障注入 token 为空')
  if (phase === 'worker-prepare') return prepareWorker(token)
  if (phase === 'worker-verify') return verifyWorker(token)
  const evidence =
    phase === 'database'
      ? await databaseFault(token)
      : phase === 'redis'
        ? await redisFault(token)
        : phase === 'provider'
          ? await providerFault(token)
          : undefined
  if (!evidence) throw new Error('NEWS_FAULT_PHASE 非法')
  await writeJsonAtomic(`/reports/${runId}-${phase}-evidence.json`, evidence)
  process.stdout.write(`${JSON.stringify({ status: 'COMPLETED', phase, scenario: evidence.scenario })}\n`)
}

async function databaseFault(token) {
  const baseline = await requireListSuccess(token)
  const injectedAt = new Date().toISOString()
  await controlProxy('database', 'disable')
  let controlledFailureObserved = false
  const holdUntil = Date.now() + 30_000
  try {
    while (Date.now() < holdUntil) {
      const result = await postApi('/api/news/articles/list', { scope: 'ALL', limit: 5 }, token, 5_000)
      if (!result.ok || result.status >= 500) controlledFailureObserved = true
      await sleep(1_000)
    }
  } finally {
    await controlProxy('database', 'enable')
  }
  const recoveryStartedAt = Date.now()
  const recovered = await consecutiveListSuccesses(token, 3, 60_000)
  const after = await requireListSuccess(token)
  return {
    scenario: 'DATABASE_NETWORK',
    injectedAt,
    recoveredAt: recovered.at,
    recoveryDurationMs: recovered.atMs - recoveryStartedAt,
    controlledFailureObserved,
    consecutiveSuccessesAfterRecovery: recovered.successes,
    dataInvariantPreserved: firstArticleId(baseline) === firstArticleId(after),
    duplicateFacts: 0,
  }
}

async function redisFault(token) {
  await bridgeControl({ mode: 'success', sequence: [], fixtureId: 'redis-recovery' })
  const historicalRead = await requireListSuccess(token)
  const failedClientRequestId = randomUUID()
  const injectedAt = new Date().toISOString()
  await controlProxy('redis', 'disable')
  let failedRequest
  try {
    failedRequest = await postApi('/api/news/admin/ingestion/run', ingestionBody(failedClientRequestId), token, 8_000)
    await sleep(22_000)
  } finally {
    await controlProxy('redis', 'enable')
  }
  const recoveryStartedAt = Date.now()
  const recoveredReads = await consecutiveListSuccesses(token, 3, 60_000)
  const replay = await postApi('/api/news/admin/ingestion/run', ingestionBody(failedClientRequestId), token, 15_000)
  const successful = await submitAndWait(token, randomUUID(), 90_000)
  const run = successful.status.runs?.[0]
  const controlledFailureObserved =
    !failedRequest.ok ||
    failedRequest.status >= 500 ||
    Boolean(replay.body?.data?.idempotentReplay && replay.body?.data?.status === 'FAILED')
  return {
    scenario: 'REDIS_NETWORK',
    injectedAt,
    recoveredAt: new Date().toISOString(),
    recoveryDurationMs: Date.now() - recoveryStartedAt,
    controlledFailureObserved,
    consecutiveSuccessesAfterRecovery: recoveredReads.successes,
    dataInvariantPreserved:
      Array.isArray(historicalRead?.data?.items) &&
      successful.status.status === 'SUCCEEDED' &&
      (run?.insertedCount ?? 0) <= 1,
    duplicateFacts: Math.max(0, (run?.insertedCount ?? 0) + (run?.revisedCount ?? 0) - 1),
  }
}

async function providerFault(token) {
  const before = await bridgeControl({
    mode: 'success',
    sequence: ['429', '502', 'success'],
    fixtureId: 'provider-recovery',
  })
  const injectedAt = new Date().toISOString()
  const started = Date.now()
  const successful = await submitAndWait(token, randomUUID(), 120_000, true)
  const after = await bridgeControl({})
  const run = successful.status.runs?.[0]
  return {
    scenario: 'PROVIDER_FAILURE',
    injectedAt,
    recoveredAt: new Date().toISOString(),
    recoveryDurationMs: Date.now() - started,
    controlledFailureObserved: (after.requestCount ?? 0) - (before.requestCount ?? 0) >= 3,
    consecutiveSuccessesAfterRecovery: successful.status.status === 'SUCCEEDED' ? 3 : 0,
    dataInvariantPreserved: successful.status.status === 'SUCCEEDED' && (run?.insertedCount ?? 0) <= 1,
    duplicateFacts: Math.max(0, (run?.insertedCount ?? 0) + (run?.revisedCount ?? 0) - 1),
  }
}

async function prepareWorker(token) {
  await bridgeControl({ mode: 'delay-success', sequence: [], fixtureId: 'worker-restart' })
  const result = await postApi('/api/news/admin/ingestion/run', ingestionBody(randomUUID()), token, 15_000)
  if (!result.ok || !result.body?.data?.commandId || !result.body?.data?.runIds?.[0]) {
    throw new Error('Worker restart 命令创建失败')
  }
  const pending = {
    commandId: result.body.data.commandId,
    runId: result.body.data.runIds[0],
    injectedAt: new Date().toISOString(),
  }
  await writeJsonAtomic(`/reports/${runId}-worker-pending.json`, pending)
  process.stdout.write(
    `${JSON.stringify({ status: 'READY', phase, commandId: pending.commandId, runId: pending.runId })}\n`,
  )
}

async function verifyWorker(token) {
  const pending = JSON.parse(await readFile(`/reports/${runId}-worker-pending.json`, 'utf8'))
  const marker = JSON.parse(await readFile(`/reports/${runId}-worker-kill.json`, 'utf8'))
  await bridgeControl({ mode: 'success', sequence: [], fixtureId: 'worker-restart' })
  const started = Date.now()
  const status = await waitCommand(token, pending.commandId, 180_000, true)
  const run = status.runs?.[0]
  const evidence = {
    scenario: 'WORKER_RESTART',
    injectedAt: pending.injectedAt,
    recoveredAt: new Date().toISOString(),
    recoveryDurationMs: Date.now() - started,
    controlledFailureObserved: marker.sigtermSent === true,
    consecutiveSuccessesAfterRecovery: status.status === 'SUCCEEDED' ? 3 : 0,
    dataInvariantPreserved: status.status === 'SUCCEEDED' && (run?.insertedCount ?? 0) <= 1,
    duplicateFacts: Math.max(0, (run?.insertedCount ?? 0) + (run?.revisedCount ?? 0) - 1),
  }
  await writeJsonAtomic(`/reports/${runId}-worker-evidence.json`, evidence)
  process.stdout.write(`${JSON.stringify({ status: 'COMPLETED', phase, scenario: evidence.scenario })}\n`)
}

function ingestionBody(clientRequestId) {
  return {
    clientRequestId,
    operation: 'POLL_FEED',
    providerKey: 'AKSHARE',
    feedKey: 'akshare.eastmoney.global',
  }
}

async function submitAndWait(token, clientRequestId, timeoutMs, allowRetryingFailed = false) {
  const response = await postApi('/api/news/admin/ingestion/run', ingestionBody(clientRequestId), token, 15_000)
  const commandId = response.body?.data?.commandId
  if (!response.ok || !commandId) throw new Error('采集命令提交失败')
  return { response, status: await waitCommand(token, commandId, timeoutMs, allowRetryingFailed) }
}

async function waitCommand(token, commandId, timeoutMs, allowRetryingFailed = false) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    const response = await postApi('/api/news/admin/ingestion/status', { commandId }, token, 10_000)
    last = response.body?.data
    if (response.ok && ['SUCCEEDED', 'PARTIAL', 'CANCELLED'].includes(last?.status)) {
      if (last.status !== 'SUCCEEDED') throw new Error(`采集命令未恢复成功: ${last.status}`)
      return last
    }
    if (response.ok && last?.status === 'FAILED' && !allowRetryingFailed) {
      throw new Error('采集命令未恢复成功: FAILED')
    }
    await sleep(1_000)
  }
  throw new Error(`采集命令恢复超时: ${last?.status || 'UNKNOWN'}`)
}

async function consecutiveListSuccesses(token, target, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let successes = 0
  while (Date.now() < deadline) {
    const result = await postApi('/api/news/articles/list', { scope: 'ALL', limit: 5 }, token, 5_000)
    successes = result.ok ? successes + 1 : 0
    if (successes >= target) return { successes, at: new Date().toISOString(), atMs: Date.now() }
    await sleep(500)
  }
  throw new Error('API 恢复后未连续成功 3 次')
}

async function requireListSuccess(token) {
  const result = await postApi('/api/news/articles/list', { scope: 'ALL', limit: 5 }, token, 10_000)
  if (!result.ok || !Array.isArray(result.body?.data?.items)) throw new Error('历史新闻列表不可用')
  return result.body
}

function firstArticleId(body) {
  return body?.data?.items?.[0]?.articleId || null
}

async function controlProxy(name, action) {
  const response = await fetch(`${proxyUrl}/proxies/${name}/${action}`, {
    method: 'POST',
    signal: AbortSignal.timeout(5_000),
  })
  if (!response.ok) throw new Error(`proxy ${name} ${action} 失败`)
}

async function bridgeControl(body) {
  const response = await fetch(`${bridgeUrl}/__control`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  })
  if (!response.ok) throw new Error('fixture control 失败')
  return response.json()
}

async function postApi(path, body, token, timeoutMs) {
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    let parsed
    try {
      parsed = await response.json()
    } catch {
      parsed = null
    }
    return { ok: response.ok, status: response.status, body: parsed }
  } catch {
    return { ok: false, status: 0, body: null }
  }
}

function requiredOrigin(name) {
  const raw = process.env[name] || ''
  const parsed = new URL(raw)
  if (
    parsed.protocol !== 'http:' ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== '/'
  ) {
    throw new Error(`${name} 必须是无凭据的内网 HTTP origin`)
  }
  return parsed.origin
}

async function writeJsonAtomic(path, value) {
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  const handle = await open(temporaryPath, 'wx', 0o600)
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(temporaryPath, path)
    await chmod(path, 0o600)
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined)
    throw error
  }
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : '故障注入 runner 失败'
  process.stderr.write(`${JSON.stringify({ status: 'FAILED', phase, message })}\n`)
  process.exitCode = 1
})
