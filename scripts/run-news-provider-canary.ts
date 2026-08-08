import {
  runNewsProviderCanary,
  type NewsCanaryEnvironment,
  type NewsCanaryFetch,
} from 'src/apps/news/nonfunctional/news-canary'

const fetcher: NewsCanaryFetch = async (url, init) => {
  const response = await fetch(url, init)
  return { status: response.status, json: () => response.json() }
}

async function main(): Promise<void> {
  const report = await runNewsProviderCanary({
    env: process.env as NewsCanaryEnvironment,
    fetcher,
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    now: () => new Date(),
  })
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (report.status === 'FAILED') process.exitCode = 1
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Canary 启动失败'
  process.stderr.write(`${JSON.stringify({ status: 'FAILED', errorCode: 'CANARY_CONFIGURATION_INVALID', message })}\n`)
  process.exitCode = 1
})
