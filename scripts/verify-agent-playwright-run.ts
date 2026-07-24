import { PrismaClient } from '@prisma/client'

interface RunEvidence {
  runId: string
  userId: number
  conversationId: string
  triggerMessageId: string
  responseMessageId: string
  runStatus: string
  assistantStatus: string
  contentBlockTypes: string[]
  stepCount: number
  toolCalls: Array<{ toolName: string; status: string; attemptCount: number }>
  modelCalls: Array<{ purpose: string; status: string; attemptCount: number }>
  citationCount: number
  citationToolCallCount: number
  sequences: number[]
  sequenceContinuous: boolean
  terminalEvents: string[]
  lastEventType: string | null
}

const runIds = process.argv.slice(2).filter((value) => value.length > 0)
if (runIds.length === 0) throw new Error('至少传入一个 runId')
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL 未配置')

const prisma = new PrismaClient()

async function main(): Promise<void> {
  const evidence = await Promise.all(runIds.map(readRunEvidence))
  process.stdout.write(`${JSON.stringify(evidence)}\n`)
}

async function readRunEvidence(runId: string): Promise<RunEvidence> {
  const run = await prisma.aiAgentRun.findUniqueOrThrow({
    where: { id: runId },
    include: {
      responseMessage: { include: { citations: true } },
      steps: true,
      toolCalls: { orderBy: { startedAt: 'asc' } },
      modelCalls: { orderBy: { startedAt: 'asc' } },
      events: { orderBy: { sequence: 'asc' } },
    },
  })
  const sequences = run.events.map((event) => Number(event.sequence))
  const terminalEvents = run.events
    .map((event) => event.eventType)
    .filter((eventType) => ['agent.completed', 'agent.failed', 'agent.cancelled'].includes(eventType))
  const blocks = Array.isArray(run.responseMessage.contentBlocks)
    ? run.responseMessage.contentBlocks
    : []

  return {
    runId,
    userId: run.userId,
    conversationId: run.conversationId,
    triggerMessageId: run.triggerMessageId,
    responseMessageId: run.responseMessageId,
    runStatus: run.status,
    assistantStatus: run.responseMessage.status,
    contentBlockTypes: blocks
      .map((block) =>
        block && typeof block === 'object' && !Array.isArray(block) && typeof block.type === 'string'
          ? block.type
          : null,
      )
      .filter((value): value is string => value !== null),
    stepCount: run.steps.length,
    toolCalls: run.toolCalls.map((call) => ({
      toolName: call.toolName,
      status: call.status,
      attemptCount: call.attemptCount,
    })),
    modelCalls: run.modelCalls.map((call) => ({
      purpose: call.purpose,
      status: call.status,
      attemptCount: call.attemptCount,
    })),
    citationCount: run.responseMessage.citations.length,
    citationToolCallCount: run.responseMessage.citations.filter((citation) => citation.toolCallId !== null).length,
    sequences,
    sequenceContinuous: sequences.every((sequence, index) => sequence === index + 1),
    terminalEvents,
    lastEventType: run.events.at(-1)?.eventType ?? null,
  }
}

void main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
  .finally(async () => prisma.$disconnect())
