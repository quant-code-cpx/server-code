import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common'
import { AiEvaluationRunStatus, Prisma } from '@prisma/client'
import { PrismaService } from 'src/shared/prisma.service'
import {
  evaluateAgentRegression,
  type AgentEvaluationCaseResult,
  type AgentRegressionSummary,
} from './agent-evaluation-runner'

export interface RunAgentEvaluationCommand {
  clientRequestId: string
  dataset: 'mvp'
  provider: 'fake'
}

@Injectable()
export class AgentEvaluationService {
  constructor(private readonly prisma: PrismaService) {}

  async run(requestedByUserId: number, command: RunAgentEvaluationCommand) {
    const existing = await this.prisma.aiEvaluationRun.findUnique({
      where: { requestedByUserId_clientRequestId: { requestedByUserId, clientRequestId: command.clientRequestId } },
    })
    if (existing) return toRunSummary(existing)

    const summary = evaluateAgentRegression(process.cwd(), { dataset: command.dataset, provider: command.provider })
    let evaluationRun
    try {
      evaluationRun = await this.prisma.aiEvaluationRun.create({
        data: {
          requestedByUserId,
          clientRequestId: command.clientRequestId,
          datasetId: summary.dataset.id,
          datasetVersion: summary.dataset.version,
          datasetHash: summary.dataset.hash,
          workflowVersion: summary.dataset.workflowVersion,
          promptVersion: summary.dataset.promptVersion,
          modelVersion: summary.dataset.modelVersion,
          provider: summary.provider,
          policy: toJson({ execution: 'synchronous', provider: 'fake', gate: 'required' }),
          artifactRef: datasetArtifactRef(summary),
        },
      })
    } catch (error) {
      if (isUniqueRequestError(error)) {
        const repeated = await this.prisma.aiEvaluationRun.findUnique({
          where: { requestedByUserId_clientRequestId: { requestedByUserId, clientRequestId: command.clientRequestId } },
        })
        if (repeated) return toRunSummary(repeated)
      }
      throw error
    }

    try {
      const cases = persistedCases(summary)
      const totalCost = cases.reduce((sum, result) => sum + result.cost, 0)
      const completed = await this.prisma.$transaction(async (tx) => {
        await tx.aiEvaluationResult.createMany({
          data: cases.map((result) => ({
            evaluationRunId: evaluationRun.id,
            caseId: result.id,
            caseHash: result.caseHash,
            passed: result.pass,
            factScore: result.factScore,
            citationCoverage: result.citationCoverage,
            toolTraceMatch: result.toolTraceMatch,
            latencyMs: result.latencyMs,
            cost: result.cost,
            costCurrency: 'CNY',
            failures: toJson(result.failures),
            evidenceSummary: toJson({ failureCount: result.failures.length }),
            artifactRef: `${datasetArtifactRef(summary)}#${result.id}`,
          })),
        })
        return tx.aiEvaluationRun.update({
          where: { id: evaluationRun.id },
          data: {
            status: AiEvaluationRunStatus.COMPLETED,
            gatePassed: summary.pass,
            totalCases: cases.length,
            passedCases: cases.filter((result) => result.pass).length,
            failedCases: cases.filter((result) => !result.pass).length,
            totalCost,
            summary: toJson(compactSummary(summary)),
            endedAt: new Date(),
          },
        })
      })
      return toRunSummary(completed)
    } catch (error) {
      await this.prisma.aiEvaluationRun.update({
        where: { id: evaluationRun.id },
        data: {
          status: AiEvaluationRunStatus.FAILED,
          gatePassed: false,
          errorMessage: safeErrorMessage(error),
          endedAt: new Date(),
        },
      })
      throw new InternalServerErrorException('Agent 评测执行失败')
    }
  }

  async status(evaluationRunId: string) {
    const run = await this.prisma.aiEvaluationRun.findUnique({ where: { id: evaluationRunId } })
    if (!run) throw new NotFoundException('Agent 评测运行不存在')
    return toRunSummary(run)
  }

  async detail(evaluationRunId: string, caseId: string) {
    const result = await this.prisma.aiEvaluationResult.findUnique({
      where: { evaluationRunId_caseId: { evaluationRunId, caseId } },
      include: {
        evaluationRun: {
          select: {
            id: true,
            datasetId: true,
            datasetVersion: true,
            datasetHash: true,
            workflowVersion: true,
            promptVersion: true,
            modelVersion: true,
            provider: true,
            gatePassed: true,
          },
        },
      },
    })
    if (!result) throw new NotFoundException('Agent 评测用例不存在')
    return {
      evaluationRunId: result.evaluationRunId,
      caseId: result.caseId,
      caseHash: result.caseHash,
      passed: result.passed,
      factScore: decimal(result.factScore),
      citationCoverage: decimal(result.citationCoverage),
      toolTraceMatch: result.toolTraceMatch,
      latencyMs: result.latencyMs,
      cost: decimal(result.cost),
      costCurrency: result.costCurrency,
      failures: result.failures,
      evidenceSummary: result.evidenceSummary,
      artifactRef: result.artifactRef,
      dataset: {
        id: result.evaluationRun.datasetId,
        version: result.evaluationRun.datasetVersion,
        hash: result.evaluationRun.datasetHash,
      },
      versions: {
        workflow: result.evaluationRun.workflowVersion,
        prompt: result.evaluationRun.promptVersion,
        model: result.evaluationRun.modelVersion,
        provider: result.evaluationRun.provider,
      },
      gatePassed: result.evaluationRun.gatePassed,
    }
  }
}

function persistedCases(summary: AgentRegressionSummary): AgentEvaluationCaseResult[] {
  return [
    {
      id: 'financial-golden',
      caseHash: summary.dataset.hash,
      pass: summary.financial.failures.length === 0,
      factScore: 1,
      citationCoverage: 1,
      toolTraceMatch: true,
      latencyMs: 0,
      cost: 0,
      failures: summary.financial.failures,
    },
    ...summary.model.results,
  ]
}

function compactSummary(summary: AgentRegressionSummary) {
  return {
    pass: summary.pass,
    gate: summary.gate,
    financial: summary.financial,
    model: { passed: summary.model.passed, total: summary.model.total },
  }
}

function datasetArtifactRef(summary: AgentRegressionSummary): string {
  return `agent-evaluation://${summary.dataset.id}/${summary.dataset.version}/${summary.dataset.hash}`
}

function toRunSummary(run: {
  id: string
  requestedByUserId: number
  clientRequestId: string
  datasetId: string
  datasetVersion: string
  datasetHash: string
  workflowVersion: string
  promptVersion: string
  modelVersion: string
  provider: string
  status: AiEvaluationRunStatus
  gatePassed: boolean | null
  totalCases: number
  passedCases: number
  failedCases: number
  totalCost: { toNumber(): number }
  costCurrency: string
  summary: Prisma.JsonValue | null
  artifactRef: string | null
  errorMessage: string | null
  startedAt: Date
  endedAt: Date | null
}) {
  return {
    evaluationRunId: run.id,
    requestedByUserId: run.requestedByUserId,
    clientRequestId: run.clientRequestId,
    status: run.status,
    gatePassed: run.gatePassed,
    dataset: { id: run.datasetId, version: run.datasetVersion, hash: run.datasetHash },
    versions: {
      workflow: run.workflowVersion,
      prompt: run.promptVersion,
      model: run.modelVersion,
      provider: run.provider,
    },
    counts: { total: run.totalCases, passed: run.passedCases, failed: run.failedCases },
    totalCost: decimal(run.totalCost),
    costCurrency: run.costCurrency,
    summary: run.summary,
    artifactRef: run.artifactRef,
    errorMessage: run.errorMessage,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
  }
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue
}

function decimal(value: { toNumber(): number }): number {
  return value.toNumber()
}

function isUniqueRequestError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 1_000) : 'unknown evaluation error'
}
