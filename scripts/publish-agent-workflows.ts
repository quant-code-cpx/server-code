import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { AiVersionStatus, Prisma, PrismaClient, UserRole } from '@prisma/client'
import { WorkflowRegistryService } from 'src/apps/agent/workflow/workflow-registry.service'
import { CONVERSATION_SUMMARY_PROMPT_V1 } from 'src/apps/agent/memory/conversation-summary.prompt'
import { STOCK_RESEARCH_WORKFLOW_DEFINITIONS } from 'src/apps/agent/workflow/workflows/stock-research.v10'

loadDatabaseUrl()
const prisma = new PrismaClient()

async function main(): Promise<void> {
  const registry = new WorkflowRegistryService(STOCK_RESEARCH_WORKFLOW_DEFINITIONS)
  registry.onModuleInit()
  const snapshots = STOCK_RESEARCH_WORKFLOW_DEFINITIONS.map((definition) =>
    registry.snapshot(definition.key, definition.version),
  )
  const publisher = await prisma.user.findFirst({
    where: { role: { in: [UserRole.SUPER_ADMIN, UserRole.ADMIN] } },
    orderBy: { id: 'asc' },
    select: { id: true },
  })
  if (!publisher) throw new Error('发布 Agent Workflow 前需要至少一个管理员账号')

  const result = await prisma.$transaction(async (tx) => {
    const prompts = []
    const seenPrompts = new Set<string>()
    for (const snapshot of snapshots) {
      const key = `${snapshot.prompt.promptKey}@${snapshot.prompt.version}`
      if (seenPrompts.has(key)) continue
      seenPrompts.add(key)
      prompts.push(await ensurePromptVersion(tx, snapshot.prompt, publisher.id))
    }
    const summaryPrompt = await ensurePromptVersion(tx, CONVERSATION_SUMMARY_PROMPT_V1, publisher.id)
    const workflows = []
    for (const snapshot of snapshots) workflows.push(await ensureWorkflowVersion(tx, snapshot, publisher.id))
    return { prompts, summaryPrompt, workflows }
  })
  process.stdout.write(
    `Agent workflows published: ${result.workflows
      .map((workflow) => `${workflow.workflowKey}@${workflow.version}`)
      .join(', ')}, prompts ${result.prompts
      .map((prompt) => `${prompt.promptKey}@${prompt.version}`)
      .join(', ')}, ${result.summaryPrompt.promptKey}@${result.summaryPrompt.version}\n`,
  )
}

async function ensurePromptVersion(
  tx: Prisma.TransactionClient,
  prompt: {
    promptKey: string
    version: number
    template: string
    inputSchema: Record<string, unknown>
    outputSchema: Record<string, unknown>
    contentHash: string
  },
  publisherId: number,
) {
  const existing = await tx.aiPromptVersion.findUnique({
    where: { promptKey_version: { promptKey: prompt.promptKey, version: prompt.version } },
  })
  if (existing && existing.contentHash !== prompt.contentHash) {
    throw new Error(`Prompt ${prompt.promptKey}@${prompt.version} 已存在但 hash 不同`)
  }
  const version =
    existing ??
    (await tx.aiPromptVersion.create({
      data: {
        promptKey: prompt.promptKey,
        version: prompt.version,
        template: prompt.template,
        inputSchema: prompt.inputSchema as Prisma.InputJsonValue,
        outputSchema: prompt.outputSchema as Prisma.InputJsonValue,
        contentHash: prompt.contentHash,
        createdBy: publisherId,
      },
    }))
  if (version.status === AiVersionStatus.PUBLISHED) return version
  if (version.status !== AiVersionStatus.DRAFT) throw new Error('仅 DRAFT Prompt 可发布')
  return tx.aiPromptVersion.update({
    where: { id: version.id },
    data: { status: AiVersionStatus.PUBLISHED, publishedBy: publisherId, publishedAt: new Date() },
  })
}

async function ensureWorkflowVersion(
  tx: Prisma.TransactionClient,
  snapshot: ReturnType<WorkflowRegistryService['snapshot']>,
  publisherId: number,
) {
  const existing = await tx.aiWorkflowVersion.findUnique({
    where: { workflowKey_version: { workflowKey: snapshot.workflowKey, version: snapshot.version } },
  })
  if (existing && existing.contentHash !== snapshot.contentHash) {
    throw new Error(`Workflow ${snapshot.workflowKey}@${snapshot.version} 已存在但 hash 不同`)
  }
  const version =
    existing ??
    (await tx.aiWorkflowVersion.create({
      data: {
        workflowKey: snapshot.workflowKey,
        version: snapshot.version,
        definition: snapshot.definition as Prisma.InputJsonValue,
        toolAllowlist: snapshot.toolAllowlist as Prisma.InputJsonValue,
        inputSchema: snapshot.inputSchema as Prisma.InputJsonValue,
        outputSchema: snapshot.outputSchema as Prisma.InputJsonValue,
        contentHash: snapshot.contentHash,
        createdBy: publisherId,
      },
    }))
  if (version.status === AiVersionStatus.PUBLISHED) return version
  if (version.status !== AiVersionStatus.DRAFT) throw new Error('仅 DRAFT Workflow 可发布')
  return tx.aiWorkflowVersion.update({
    where: { id: version.id },
    data: { status: AiVersionStatus.PUBLISHED, publishedBy: publisherId, publishedAt: new Date() },
  })
}

function loadDatabaseUrl(): void {
  if (process.env.DATABASE_URL) return
  const envPath = resolve('.env')
  if (!existsSync(envPath)) throw new Error('缺少 DATABASE_URL，且未找到 .env')
  const match = readFileSync(envPath, 'utf8').match(/^DATABASE_URL=(?:"([^"]+)"|([^#\r\n]+))/m)
  const value = match?.[1] ?? match?.[2]?.trim()
  if (!value) throw new Error('.env 中缺少 DATABASE_URL')
  process.env.DATABASE_URL = value
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Agent workflow publish failed'}\n`)
    process.exitCode = 1
  })
  .finally(async () => prisma.$disconnect())
