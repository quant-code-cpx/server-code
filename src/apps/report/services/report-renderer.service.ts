import { Injectable, Logger } from '@nestjs/common'
import * as fs from 'fs/promises'
import * as Handlebars from 'handlebars'
import * as path from 'path'
import * as puppeteer from 'puppeteer'

export interface RenderResult {
  html?: string
  filePath?: string
  fileSize?: number
}

@Injectable()
export class ReportRendererService {
  private readonly logger = new Logger(ReportRendererService.name)
  private readonly templateDir = path.join(__dirname, '..', 'templates')
  private readonly outputDir = resolveDirectory(process.env.REPORT_STORAGE_DIR, 'storage/reports')
  private readonly temporaryDir = resolveDirectory(process.env.APP_TMP_DIR, 'tmp')

  private templateCache = new Map<string, HandlebarsTemplateDelegate>()

  async onModuleInit() {
    await Promise.all([fs.mkdir(this.outputDir, { recursive: true }), fs.mkdir(this.temporaryDir, { recursive: true })])
  }

  // ─── HTML 渲染 ─────────────────────────────────────────────────────────────

  async renderHtml(templateName: string, data: Record<string, unknown>): Promise<string> {
    const template = await this.getTemplate(templateName)
    return template(data)
  }

  // ─── 文件写入（HTML） ─────────────────────────────────────────────────────

  async renderToHtmlFile(templateName: string, data: Record<string, unknown>, reportId: string): Promise<RenderResult> {
    const html = await this.renderHtml(templateName, data)
    const fileName = `${reportId}.html`
    const filePath = path.join(this.outputDir, fileName)
    await fs.writeFile(filePath, html, 'utf-8')
    const stat = await fs.stat(filePath)
    return { html, filePath: `storage/reports/${fileName}`, fileSize: stat.size }
  }

  // ─── PDF 渲染 ──────────────────────────────────────────────────────────────

  async renderToPdf(templateName: string, data: Record<string, unknown>, reportId: string): Promise<RenderResult> {
    if (!this.isPdfRenderingEnabled()) {
      throw new Error('[ReportRenderer] 当前进程未启用 PDF 渲染')
    }

    const html = await this.renderHtml(templateName, data)
    const fileName = `${reportId}.pdf`
    const filePath = path.join(this.outputDir, fileName)

    let browser: puppeteer.Browser | null = null
    try {
      browser = await puppeteer.launch({
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        env: { ...process.env, TMPDIR: this.temporaryDir },
      })
      const page = await browser.newPage()
      await page.setJavaScriptEnabled(false)
      await page.setRequestInterception(true)
      page.on('request', (request) => {
        if (request.isNavigationRequest() && request.url() === 'about:blank') {
          request.continue()
          return
        }
        request.abort('blockedbyclient')
      })
      await page.setContent(html, { waitUntil: 'domcontentloaded' })
      await page.pdf({
        path: filePath,
        format: 'A4',
        printBackground: true,
        margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
      })
    } finally {
      if (browser) await browser.close()
    }

    const stat = await fs.stat(filePath)
    return { filePath: `storage/reports/${fileName}`, fileSize: stat.size }
  }

  isPdfRenderingEnabled(): boolean {
    return process.env.REPORT_PDF_ENABLED?.trim().toLowerCase() !== 'false'
  }

  // ─── 模板加载 ─────────────────────────────────────────────────────────────

  private async getTemplate(name: string): Promise<HandlebarsTemplateDelegate> {
    const cached = this.templateCache.get(name)
    if (cached) return cached

    const filePath = path.join(this.templateDir, `${name}.hbs`)
    const source = await fs.readFile(filePath, 'utf-8')
    const compiled = Handlebars.compile(source)
    this.templateCache.set(name, compiled)
    return compiled
  }
}

function resolveDirectory(configuredPath: string | undefined, fallback: string): string {
  return path.resolve(configuredPath?.trim() || path.join(process.cwd(), fallback))
}
