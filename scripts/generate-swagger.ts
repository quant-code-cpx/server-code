import 'reflect-metadata'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { AppModule } from '../src/app.module'

async function main() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] })

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Quant Server API')
    .setDescription('量化交易后端接口文档')
    .setVersion('1.0')
    .addBearerAuth()
    .addCookieAuth('refresh_token')
    .build()

  const document = SwaggerModule.createDocument(app, swaggerConfig)
  const outputPath = join(process.cwd(), 'swagger.json')
  await writeFile(outputPath, JSON.stringify(document, null, 2), 'utf-8')
  console.log(`[swagger] generated: ${outputPath}`)
  // 避免基础设施连接（如 Redis）在关闭阶段抛出非关键异常影响 hook 流程
  process.exit(0)
}

main().catch((error) => {
  console.error('[swagger] generate failed:', error)
  process.exit(1)
})
