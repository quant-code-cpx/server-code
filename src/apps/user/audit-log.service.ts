import { Injectable, Logger } from '@nestjs/common'
import { AuditAction, Prisma } from '@prisma/client'
import { PrismaService } from 'src/shared/prisma.service'
import { AuditLogQueryDto } from './dto/audit-log-query.dto'

export interface AuditRecordParams {
  operatorId: number
  operatorAccount: string
  action: AuditAction
  targetId?: number
  targetAccount?: string
  details?: Record<string, unknown>
  ipAddress?: string
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name)

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 写入一条审计记录。
   * 采用 fire-and-forget 模式：失败时仅记录错误日志，不阻塞主流程。
   */
  record(params: AuditRecordParams): void {
    this.prisma.auditLog
      .create({
        data: {
          operatorId: params.operatorId,
          operatorAccount: params.operatorAccount,
          action: params.action,
          targetId: params.targetId ?? null,
          targetAccount: params.targetAccount ?? null,
          details: params.details ? (params.details as Prisma.InputJsonValue) : undefined,
          ipAddress: params.ipAddress ?? null,
        },
      })
      .catch((err: unknown) => {
        this.logger.error(
          `审计日志写入失败 [action=${params.action} operator=${params.operatorAccount}]: ${err instanceof Error ? err.message : String(err)}`,
        )
      })
  }

  /**
   * 分页查询审计日志（管理员以上权限）。
   */
  async findAll(query: AuditLogQueryDto) {
    const { page, pageSize, operatorId, targetId, action, startDate, endDate } = query
    const skip = (page - 1) * pageSize

    const where = {
      ...(operatorId !== undefined ? { operatorId } : {}),
      ...(targetId !== undefined ? { targetId } : {}),
      ...(action ? { action } : {}),
      ...(startDate || endDate
        ? {
            createdAt: {
              ...(startDate ? { gte: new Date(startDate) } : {}),
              ...(endDate ? { lte: new Date(endDate) } : {}),
            },
          }
        : {}),
    }

    const [total, items] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
    ])

    return { total, page, pageSize, items }
  }
}
