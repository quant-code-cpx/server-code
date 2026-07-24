import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import * as puppeteer from 'puppeteer'
import { ReportRendererService } from '../services/report-renderer.service'

describe('ReportRendererService', () => {
  const envKeys = ['REPORT_STORAGE_DIR', 'APP_TMP_DIR', 'PUPPETEER_EXECUTABLE_PATH', 'REPORT_PDF_ENABLED'] as const
  const originalEnv = new Map(envKeys.map((key) => [key, process.env[key]]))
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'quant-report-renderer-'))
    process.env.REPORT_STORAGE_DIR = path.join(root, 'reports')
    process.env.APP_TMP_DIR = path.join(root, 'tmp')
    process.env.PUPPETEER_EXECUTABLE_PATH = '/usr/bin/chromium'
    delete process.env.REPORT_PDF_ENABLED
  })

  afterEach(async () => {
    jest.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
    for (const key of envKeys) {
      const value = originalEnv.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('[BIZ] 配置的报告目录可写，返回路径保持公共 API 相对格式', async () => {
    const service = new ReportRendererService()
    await service.onModuleInit()

    const result = await service.renderToHtmlFile(
      'stock',
      { overview: { name: '浦发银行', tsCode: '600000.SH' }, top10Holders: [], dividends: [] },
      'report-1',
    )

    expect(result.filePath).toBe('storage/reports/report-1.html')
    await expect(readFile(path.join(root, 'reports', 'report-1.html'), 'utf8')).resolves.toContain('浦发银行')
  })

  it('[SEC] PDF 渲染启用系统 Chromium、隔离临时目录，不传 --no-sandbox', async () => {
    const page = {
      setJavaScriptEnabled: jest.fn(),
      setRequestInterception: jest.fn(),
      on: jest.fn(),
      setContent: jest.fn(),
      pdf: jest.fn(async ({ path: outputPath }: { path?: string }) => {
        if (!outputPath) throw new Error('missing PDF output path')
        await writeFile(outputPath, 'pdf')
      }),
    }
    const browser = { newPage: jest.fn(async () => page), close: jest.fn() }
    const launch = jest.spyOn(puppeteer, 'launch').mockResolvedValue(browser as unknown as puppeteer.Browser)
    const service = new ReportRendererService()
    await service.onModuleInit()

    await service.renderToPdf(
      'stock',
      { overview: { name: '浦发银行', tsCode: '600000.SH' }, top10Holders: [], dividends: [] },
      'report-2',
    )

    expect(launch).toHaveBeenCalledWith(
      expect.objectContaining({
        executablePath: '/usr/bin/chromium',
        env: expect.objectContaining({ TMPDIR: path.join(root, 'tmp') }),
      }),
    )
    expect(launch.mock.calls[0][0]?.args ?? []).not.toContain('--no-sandbox')
    expect(page.setJavaScriptEnabled).toHaveBeenCalledWith(false)
    expect(page.setRequestInterception).toHaveBeenCalledWith(true)
    expect(browser.close).toHaveBeenCalledTimes(1)
  })

  it('[SEC] 显式禁用 PDF 时不启动 Chromium', async () => {
    process.env.REPORT_PDF_ENABLED = 'false'
    const launch = jest.spyOn(puppeteer, 'launch')
    const service = new ReportRendererService()

    await expect(service.renderToPdf('stock', {}, 'report-3')).rejects.toThrow('当前进程未启用 PDF 渲染')
    expect(launch).not.toHaveBeenCalled()
  })
})
