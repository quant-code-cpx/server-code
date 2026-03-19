import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'

/**
 * PrismaService — 数据库访问层的核心服务。
 *
 * 继承 PrismaClient 并与 NestJS 生命周期集成：
 *   - 模块初始化时自动建立数据库连接
 *   - 模块销毁时自动断开连接，避免连接泄漏
 *
 * 本服务通过 SharedModule（@Global）全局注册，无需在各功能模块中重复导入。
 * 使用方式：在构造函数中注入 PrismaService，然后通过 this.prisma.<model> 访问数据。
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  /** 应用启动时由 NestJS 的模块初始化流程调用，建立 PostgreSQL 连接池。 */
  async onModuleInit() {
    await this.$connect()
  }

  /** 应用关闭时由 NestJS 的模块销毁流程调用，优雅地释放数据库连接。 */
  async onModuleDestroy() {
    await this.$disconnect()
  }
}
