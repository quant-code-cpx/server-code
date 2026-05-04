import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { AuditAction, Prisma, UserRole, UserStatus } from '@prisma/client'
import * as bcrypt from 'bcrypt'
import { PrismaService } from 'src/shared/prisma.service'
import { TokenPayload } from 'src/shared/token.interface'
import { BusinessException } from 'src/common/exceptions/business.exception'
import { ErrorEnum } from 'src/constant/response-code.constant'
import { RANDOM_PASSWORD_LENGTH, ROLE_LEVEL, SUPER_ADMIN_ENV, UNLIMITED_QUOTA } from 'src/constant/user.constant'
import { CreateUserDto } from './dto/create-user.dto'
import { UpdateProfileDto } from './dto/update-profile.dto'
import { ChangePasswordDto } from './dto/change-password.dto'
import { UpdateUserStatusDto } from './dto/update-user-status.dto'
import { UserListQueryDto } from './dto/user-list-query.dto'
import { AdminUpdateUserDto } from './dto/admin-update-user.dto'
import { ResetPasswordDto } from './dto/reset-password.dto'
import { AuditLogService } from './audit-log.service'
import { AuditLogQueryDto } from './dto/audit-log-query.dto'
import { UpdateRoleDto } from './dto/update-role.dto'
import { UserSearchQueryDto } from './dto/user-search-query.dto'

/** 用户基础信息（不含密码）— 用于列表和详情响应 */
const USER_SAFE_SELECT = {
  id: true,
  account: true,
  nickname: true,
  role: true,
  status: true,
  email: true,
  wechat: true,
  lastLoginAt: true,
  backtestQuota: true,
  watchlistLimit: true,
  createdAt: true,
  updatedAt: true,
} as const

@Injectable()
export class UserService implements OnApplicationBootstrap {
  private readonly logger = new Logger(UserService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  // ── 应用启动：初始化超级管理员 ───────────────────────────────────────────

  async onApplicationBootstrap() {
    await this.initSuperAdmin()
  }

  private async initSuperAdmin(): Promise<void> {
    const account = process.env[SUPER_ADMIN_ENV.ACCOUNT]
    const password = process.env[SUPER_ADMIN_ENV.PASSWORD]
    const nickname = process.env[SUPER_ADMIN_ENV.NICKNAME] ?? '超级管理员'

    if (!account || !password) {
      this.logger.warn(`未配置 ${SUPER_ADMIN_ENV.ACCOUNT} / ${SUPER_ADMIN_ENV.PASSWORD} 环境变量，跳过超级管理员初始化`)
      return
    }

    const exists = await this.prisma.user.findFirst({ where: { role: UserRole.SUPER_ADMIN } })
    if (exists) {
      this.logger.log(`超级管理员已存在 [${exists.account}]，跳过初始化`)
      return
    }

    if (password.length < RANDOM_PASSWORD_LENGTH) {
      this.logger.error(
        `${SUPER_ADMIN_ENV.PASSWORD} 密码长度不能少于 ${RANDOM_PASSWORD_LENGTH} 位，当前仅 ${password.length} 位，请修改后重启`,
      )
      return
    }

    const hashedPassword = await bcrypt.hash(password, 10)
    await this.prisma.user.create({
      data: {
        account,
        password: hashedPassword,
        nickname,
        role: UserRole.SUPER_ADMIN,
        backtestQuota: UNLIMITED_QUOTA,
        watchlistLimit: UNLIMITED_QUOTA,
      },
    })
    this.logger.log(`超级管理员 [${account}] 初始化成功`)
  }

  // ── 创建用户 ─────────────────────────────────────────────────────────────

  async create(dto: CreateUserDto, operator: TokenPayload) {
    const targetRole = dto.role ?? UserRole.USER

    // 只能创建低于自身角色的账号
    if (!this.hasHigherRole(operator.role, targetRole)) {
      throw new BusinessException(ErrorEnum.CANNOT_CREATE_HIGHER_ROLE)
    }

    // 超级管理员有且仅有一个
    if (targetRole === UserRole.SUPER_ADMIN) {
      throw new BusinessException(ErrorEnum.SUPER_ADMIN_UNIQUE)
    }

    const exists = await this.prisma.user.findUnique({ where: { account: dto.account } })
    if (exists) throw new BusinessException(ErrorEnum.USER_ALREADY_EXISTS)

    // 生成密码哈希
    const rawPassword = dto.password
    const hashedPassword = await bcrypt.hash(rawPassword, 10)

    const user = await this.prisma.user.create({
      data: {
        account: dto.account,
        password: hashedPassword,
        nickname: dto.nickname,
        role: targetRole,
        ...(dto.backtestQuota !== undefined ? { backtestQuota: dto.backtestQuota } : {}),
        ...(dto.watchlistLimit !== undefined ? { watchlistLimit: dto.watchlistLimit } : {}),
      },
      select: USER_SAFE_SELECT,
    })

    this.auditLogService.record({
      operatorId: operator.id,
      operatorAccount: operator.account,
      action: AuditAction.USER_CREATE,
      targetId: user.id,
      targetAccount: user.account,
      details: {
        role: targetRole,
        backtestQuota: dto.backtestQuota,
        watchlistLimit: dto.watchlistLimit,
      },
    })

    // 将初始密码一次性返回给操作者（后续不可再获取）
    return { ...user, initialPassword: rawPassword }
  }

  // ── 用户列表（管理员以上）───────────────────────────────────────────────

  async findAll(query: UserListQueryDto) {
    const { page, pageSize, account, status, role } = query
    const skip = (page - 1) * pageSize

    const where = {
      ...(account ? { account: { contains: account } } : {}),
      ...(status ? { status } : {}),
      ...(role ? { role } : {}),
      // 列表不显示已注销账号
      NOT: { status: UserStatus.DELETED },
    }

    const [total, items] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        skip,
        take: pageSize,
        select: USER_SAFE_SELECT,
        orderBy: { [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc' },
      }),
    ])

    return { total, page, pageSize, items }
  }

  // ── 用户详情 ─────────────────────────────────────────────────────────────

  async findOne(id: number) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: USER_SAFE_SELECT,
    })
    if (!user || user.status === UserStatus.DELETED) throw new BusinessException(ErrorEnum.USER_NOT_FOUND)
    return user
  }

  // ── 个人详情（当前登录用户） ──────────────────────────────────────────────

  async getProfile(currentUser: TokenPayload) {
    return this.findOne(currentUser.id)
  }

  // ── 修改个人资料 ─────────────────────────────────────────────────────────

  async updateProfile(currentUser: TokenPayload, dto: UpdateProfileDto) {
    const updated = await this.prisma.user.update({
      where: { id: currentUser.id },
      data: dto,
      select: USER_SAFE_SELECT,
    })
    return updated
  }

  // ── 修改密码 ─────────────────────────────────────────────────────────────

  async changePassword(currentUser: TokenPayload, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: currentUser.id } })
    if (!user) throw new BusinessException(ErrorEnum.USER_NOT_FOUND)

    const valid = await bcrypt.compare(dto.oldPassword, user.password)
    if (!valid) throw new BusinessException(ErrorEnum.INVALID_PASSWORD)

    const hashedPassword = await bcrypt.hash(dto.newPassword, 10)
    await this.prisma.user.update({ where: { id: currentUser.id }, data: { password: hashedPassword } })
  }

  // ── 修改用户状态（管理员以上，需高于目标用户角色）────────────────────────

  async updateStatus(id: number, dto: Omit<UpdateUserStatusDto, 'id'>, operator: TokenPayload) {
    const target = await this.findOne(id)
    this.assertNotSuperAdmin(target.role)
    this.assertHigherRole(operator, target.role, id)
    if (id === operator.id) throw new BusinessException(ErrorEnum.CANNOT_DISABLE_SELF)

    await this.prisma.user.update({ where: { id }, data: { status: dto.status } })

    this.auditLogService.record({
      operatorId: operator.id,
      operatorAccount: operator.account,
      action: AuditAction.USER_UPDATE_STATUS,
      targetId: id,
      targetAccount: target.account,
      details: { from: target.status, to: dto.status },
    })
  }

  // ── 管理员更新用户信息（配额等）──────────────────────────────────────────

  async adminUpdateUser(id: number, dto: Omit<AdminUpdateUserDto, 'id'>, operator: TokenPayload) {
    const target = await this.findOne(id)
    this.assertNotSuperAdmin(target.role)
    this.assertHigherRole(operator, target.role, id)

    const updated = await this.prisma.user.update({ where: { id }, data: dto, select: USER_SAFE_SELECT })

    this.auditLogService.record({
      operatorId: operator.id,
      operatorAccount: operator.account,
      action: AuditAction.USER_UPDATE_INFO,
      targetId: id,
      targetAccount: target.account,
      details: { changes: dto as Record<string, unknown> },
    })

    return updated
  }

  // ── 重置用户密码（管理员以上）────────────────────────────────────────────

  async resetPassword(dto: ResetPasswordDto, operator: TokenPayload) {
    const target = await this.findOne(dto.id)
    this.assertNotSuperAdmin(target.role)
    this.assertHigherRole(operator, target.role, dto.id)

    const rawPassword = dto.newPassword
    const hashedPassword = await bcrypt.hash(rawPassword, 10)
    await this.prisma.user.update({ where: { id: dto.id }, data: { password: hashedPassword } })

    this.auditLogService.record({
      operatorId: operator.id,
      operatorAccount: operator.account,
      action: AuditAction.USER_RESET_PASSWORD,
      targetId: dto.id,
      targetAccount: target.account,
      details: {},
    })

    return { newPassword: rawPassword }
  }

  // ── 删除用户（软删除，需高于目标用户角色）────────────────────────────────

  async remove(id: number, operator: TokenPayload) {
    const target = await this.findOne(id)
    this.assertNotSuperAdmin(target.role)
    this.assertHigherRole(operator, target.role, id)
    if (id === operator.id) throw new BusinessException(ErrorEnum.CANNOT_DELETE_SELF)

    await this.prisma.user.update({ where: { id }, data: { status: UserStatus.DELETED } })

    this.auditLogService.record({
      operatorId: operator.id,
      operatorAccount: operator.account,
      action: AuditAction.USER_DELETE,
      targetId: id,
      targetAccount: target.account,
      details: { previousStatus: target.status },
    })
  }

  // ── 更新最后登录时间（由 AuthService 调用）────────────────────────────────

  async updateLastLoginAt(id: number): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { lastLoginAt: new Date() } })
  }

  // ── 修改用户角色（仅 SUPER_ADMIN）──────────────────────────────────────────

  async updateRole(dto: UpdateRoleDto, operator: TokenPayload) {
    const target = await this.findOne(dto.id)
    this.assertNotSuperAdmin(target.role)
    this.assertHigherRole(operator, target.role, dto.id)

    if (dto.role === UserRole.SUPER_ADMIN) {
      throw new BusinessException(ErrorEnum.SUPER_ADMIN_UNIQUE)
    }
    if (!this.hasHigherRole(operator.role, dto.role)) {
      throw new BusinessException(ErrorEnum.CANNOT_OPERATE_HIGHER_ROLE)
    }

    const updated = await this.prisma.user.update({
      where: { id: dto.id },
      data: { role: dto.role },
      select: USER_SAFE_SELECT,
    })

    this.auditLogService.record({
      operatorId: operator.id,
      operatorAccount: operator.account,
      action: AuditAction.USER_UPDATE_ROLE,
      targetId: dto.id,
      targetAccount: target.account,
      details: { from: target.role, to: dto.role, reason: dto.reason ?? null },
    })

    return updated
  }

  // ── 恢复已注销用户（仅 SUPER_ADMIN）───────────────────────────────────────

  async restore(id: number, operator: TokenPayload) {
    const target = await this.prisma.user.findFirst({
      where: { id, status: UserStatus.DELETED },
      select: USER_SAFE_SELECT,
    })
    if (!target) throw new BusinessException(ErrorEnum.USER_NOT_FOUND)

    const restored = await this.prisma.user.update({
      where: { id },
      data: { status: UserStatus.ACTIVE },
      select: USER_SAFE_SELECT,
    })

    this.auditLogService.record({
      operatorId: operator.id,
      operatorAccount: operator.account,
      action: AuditAction.USER_RESTORE,
      targetId: id,
      targetAccount: target.account,
      details: {},
    })

    return restored
  }

  // ── 用户统计（仅管理员以上）───────────────────────────────────────────────

  async getStats() {
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const thirtyDaysAgo = new Date(now)
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const [total, todayNew, active30d, deactivated] = await Promise.all([
      this.prisma.user.count({ where: { NOT: { status: UserStatus.DELETED } } }),
      this.prisma.user.count({ where: { createdAt: { gte: todayStart } } }),
      this.prisma.user.count({
        where: { status: UserStatus.ACTIVE, lastLoginAt: { gte: thirtyDaysAgo } },
      }),
      this.prisma.user.count({ where: { status: UserStatus.DEACTIVATED } }),
    ])

    return { total, todayNew, active30d, deactivated }
  }

  // ── 用户快速搜索（管理员以上，用于下拉选择等场景）────────────────────────

  async search(dto: UserSearchQueryDto) {
    const keyword = dto.keyword.trim()
    const items = await this.prisma.user.findMany({
      where: {
        NOT: { status: UserStatus.DELETED },
        OR: [
          { account: { contains: keyword, mode: 'insensitive' } },
          { nickname: { contains: keyword, mode: 'insensitive' } },
        ],
      },
      take: dto.limit ?? 20,
      select: { id: true, account: true, nickname: true, role: true },
      orderBy: { createdAt: 'asc' },
    })
    return { items }
  }

  // ── 审计日志查询 ──────────────────────────────────────────────────────────

  async listAuditLog(query: AuditLogQueryDto) {
    return this.auditLogService.findAll(query)
  }

  // ── 用户偏好 ─────────────────────────────────────────────────────────────

  async getPreferences(userId: number): Promise<Record<string, unknown>> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { preferences: true },
    })
    return (user.preferences as Record<string, unknown>) ?? {}
  }

  async updatePreferences(userId: number, key: string, value: unknown): Promise<Record<string, unknown>> {
    const current = await this.getPreferences(userId)
    const updated = { ...current, [key]: value }
    await this.prisma.user.update({
      where: { id: userId },
      data: { preferences: updated as Prisma.InputJsonValue },
    })
    return updated
  }

  // ── 工具方法 ─────────────────────────────────────────────────────────────

  /** 断言操作者角色严格高于目标用户角色 */
  private assertHigherRole(operator: TokenPayload, targetRole: UserRole, _targetId: number): void {
    if (!this.hasHigherRole(operator.role, targetRole)) {
      throw new BusinessException(ErrorEnum.CANNOT_OPERATE_HIGHER_ROLE)
    }
  }

  /** 断言目标不是超级管理员（任何人都不能操作 SUPER_ADMIN） */
  private assertNotSuperAdmin(targetRole: UserRole): void {
    if (targetRole === UserRole.SUPER_ADMIN) {
      throw new BusinessException(ErrorEnum.CANNOT_OPERATE_SUPER_ADMIN)
    }
  }

  /** 判断 operatorRole 是否严格高于 targetRole */
  private hasHigherRole(operatorRole: UserRole, targetRole: UserRole): boolean {
    return ROLE_LEVEL[operatorRole] > ROLE_LEVEL[targetRole]
  }
}
