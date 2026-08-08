import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

export interface NewsProviderLogScanResult {
  completed: boolean
  requestCount: number
}

const EXTERNAL_PROVIDER_MARKER = /api\.gdeltproject\.org|\/v1\/(?:feeds|notices)\//gi

export async function scanDockerContainerLogsForExternalNewsProviderRequests(
  container: string,
  since: string,
): Promise<NewsProviderLogScanResult> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(container)) throw new Error('Docker container 名称非法')
  if (!Number.isFinite(Date.parse(since))) throw new Error('日志扫描起始时间非法')

  return new Promise((resolve) => {
    const child = spawn('docker', ['logs', '--since', since, container], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let requestCount = 0
    let processError = false
    const countLine = (line: string) => {
      requestCount += line.match(EXTERNAL_PROVIDER_MARKER)?.length ?? 0
    }
    const stdout = createInterface({ input: child.stdout })
    const stderr = createInterface({ input: child.stderr })
    stdout.on('line', countLine)
    stderr.on('line', countLine)
    child.once('error', () => {
      processError = true
    })
    child.once('close', (code) => {
      stdout.close()
      stderr.close()
      resolve({ completed: !processError && code === 0, requestCount })
    })
  })
}
