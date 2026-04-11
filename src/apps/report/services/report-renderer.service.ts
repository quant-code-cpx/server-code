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
  private readonly outputDir = path.join(process.cwd(), 'storage', 'reports')

  private templateCache = new Map<string, HandlebarsTemplateDelegate>()

  async onModuleInit() {
    await fs.mkdir(this.outputDir, { recursive: true })
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
    const html = await this.renderHtml(templateName, data)
    const fileName = `${reportId}.pdf`
    const filePath = path.join(this.outputDir, fileName)

    let browser: puppeteer.Browser | null = null
    try {
      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      })
      const page = await browser.newPage()
      await page.setContent(html, { waitUntil: 'networkidle0' })
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
