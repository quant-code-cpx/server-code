/**
 * UserService — 单元测试
 *
 * 覆盖要点：
 * - create: 角色层级校验、超级管理员唯一性、重复账号
 * - changePassword: 旧密码错误、成功更改
 * - updateStatus: 不能禁用自身、角色层级限制
 * - findOne: 用户不存在
 * - remove: 不能删除自身、角色层级限制
 * - hasHigherRole: 私有方法角色比较逻辑
 */
import * as bcrypt from 'bcrypt'
import { AuditAction, UserRole, UserStatus } from '@prisma/client'
import { BusinessException } from 'src/common/exceptions/business.exception'
import { TokenPayload } from 'src/shared/token.interface'
import { UserService } from '../user.service'
import { AuditLogService } from '../audit-log.service'

// ── Mock 工厂 ─────────────────────────────────────────────────────────────────

function buildUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    account: 'test_user',
    password: '$2b$10$hashedpassword',
    nickname: '测试用户',
    role: UserRole.USER,
    status: UserStatus.ACTIVE,
    email: null,
    wechat: null,
    lastLoginAt: null,
    backtestQuota: 10,
    watchlistLimit: 10,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  }
}

function buildOperator(overrides: Partial<TokenPayload> = {}): TokenPayload {
  return {
    id: 99,
    account: 'admin',
    nickname: '管理员',
    role: UserRole.ADMIN,
    jti: 'test-jti',
    ...overrides,
  }
}

function buildPrismaMock() {
  return {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  }
}

function buildAuditLogMock() {
  return {
    record: jest.fn(),
    findAll: jest.fn(async () => ({ total: 0, page: 1, pageSize: 10, items: [] })),
  }
}

function createService(prismaMock = buildPrismaMock(), auditMock = buildAuditLogMock()): UserService {
  // @ts-ignore 局部 mock
  return new UserService(prismaMock as any, auditMock as AuditLogService)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 测试套件
// ═══════════════════════════════════════════════════════════════════════════════

describe('UserService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(bcrypt, 'hash').mockResolvedValue('$2b$10$newhash' as never)
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never)
  })

  // ── create() ──────────────────────────────────────────────────────────────

  describe('create()', () => {
    it('ADMIN 可创建 USER', async () => {
      const prisma = buildPrismaMock()
      prisma.user.findUnique.mockResolvedValue(null) // 账号不重复
      const created = buildUser({ role: UserRole.USER })
      prisma.user.create.mockResolvedValue(created)
      const svc = createService(prisma)

      const result = await svc.create(
        { account: 'new_user', password: 'pass123', nickname: '新用户', role: UserRole.USER },
        buildOperator({ role: UserRole.ADMIN }),
      )

      expect(prisma.user.create).toHaveBeenCalled()
      expect(result).toHaveProperty('account', 'test_user')
    })

    it('USER 不能创建 ADMIN（角色层级不足）', async () => {
      const svc = createService()
      await expect(
        svc.create(
          { account: 'new_admin', password: 'pass', nickname: 'n', role: UserRole.ADMIN },
          buildOperator({ role: UserRole.USER }),
        ),
      ).rejects.toThrow(BusinessException)
    })

    it('不能创建 SUPER_ADMIN', async () => {
      const svc = createService()
      await expect(
        svc.create(
          { account: 'su', password: 'pass', nickname: 'su', role: UserRole.SUPER_ADMIN },
          buildOperator({ role: UserRole.SUPER_ADMIN }),
        ),
      ).rejects.toThrow(BusinessException)
    })

    it('重复账号抛 BusinessException', async () => {
      const prisma = buildPrismaMock()
      prisma.user.findUnique.mockResolvedValue(buildUser())
      const svc = createService(prisma)

      await expect(
        svc.create(
          { account: 'test_user', password: 'pass', nickname: 'n', role: UserRole.USER },
          buildOperator({ role: UserRole.ADMIN }),
        ),
      ).rejects.toThrow(BusinessException)
    })

    it('密码以哈希方式存储（调用 bcrypt.hash）', async () => {
      const prisma = buildPrismaMock()
      prisma.user.findUnique.mockResolvedValue(null)
      prisma.user.create.mockResolvedValue(buildUser())
      const svc = createService(prisma)

      await svc.create(
        { account: 'new', password: 'plain_pass', nickname: 'n', role: UserRole.USER },
        buildOperator({ role: UserRole.ADMIN }),
      )

      expect(bcrypt.hash).toHaveBeenCalledWith('plain_pass', 10)
    })
  })

  // ── findOne() ─────────────────────────────────────────────────────────────

  describe('findOne()', () => {
    it('返回存在的用户', async () => {
      const prisma = buildPrismaMock()
      prisma.user.findUnique.mockResolvedValue(buildUser())
      const svc = createService(prisma)

      const result = await svc.findOne(1)
      expect(result).toHaveProperty('id', 1)
    })

    it('用户不存在时抛 BusinessException', async () => {
      const prisma = buildPrismaMock()
      prisma.user.findUnique.mockResolvedValue(null)
      const svc = createService(prisma)

      await expect(svc.findOne(999)).rejects.toThrow(BusinessException)
    })

    it('已注销用户（DELETED 状态）视为不存在', async () => {
      const prisma = buildPrismaMock()
      prisma.user.findUnique.mockResolvedValue(buildUser({ status: UserStatus.DELETED }))
      const svc = createService(prisma)

      await expect(svc.findOne(1)).rejects.toThrow(BusinessException)
    })
  })

  // ── changePassword() ──────────────────────────────────────────────────────

  describe('changePassword()', () => {
    it('旧密码正确时成功更改', async () => {
      const prisma = buildPrismaMock()
      prisma.user.findUnique.mockResolvedValue(buildUser())
      prisma.user.update.mockResolvedValue(buildUser())
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never)
      const svc = createService(prisma)

      await svc.changePassword(buildOperator({ id: 1 }), { oldPassword: 'old', newPassword: 'new123' })

      expect(prisma.user.update).toHaveBeenCalled()
    })

    it('旧密码错误时抛 BusinessException', async () => {
      const prisma = buildPrismaMock()
      prisma.user.findUnique.mockResolvedValue(buildUser())
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never)
      const svc = createService(prisma)

      await expect(
        svc.changePassword(buildOperator({ id: 1 }), { oldPassword: 'wrong', newPassword: 'new' }),
      ).rejects.toThrow(BusinessException)
    })

    it('用户不存在时抛 BusinessException', async () => {
      const prisma = buildPrismaMock()
      prisma.user.findUnique.mockResolvedValue(null)
      const svc = createService(prisma)

      await expect(
        svc.changePassword(buildOperator({ id: 999 }), { oldPassword: 'old', newPassword: 'new' }),
      ).rejects.toThrow(BusinessException)
    })
  })

  // ── updateStatus() ────────────────────────────────────────────────────────

  describe('updateStatus()', () => {
    it('不能禁用自身账号', async () => {
      const prisma = buildPrismaMock()
      prisma.user.findUnique.mockResolvedValue(buildUser({ id: 5, role: UserRole.USER }))
      const svc = createService(prisma)

      await expect(
        svc.updateStatus(5, { status: UserStatus.DEACTIVATED }, buildOperator({ id: 5, role: UserRole.ADMIN })),
      ).rejects.toThrow(BusinessException)
    })

    it('ADMIN 可更改 USER 状态', async () => {
      const prisma = buildPrismaMock()
      const target = buildUser({ id: 2, role: UserRole.USER })
      prisma.user.findUnique.mockResolvedValue(target)
      prisma.user.update.mockResolvedValue(target)
      const svc = createService(prisma)

      await svc.updateStatus(2, { status: UserStatus.DEACTIVATED }, buildOperator({ id: 99, role: UserRole.ADMIN }))

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 2 } }),
      )
    })

    it('USER 不能更改 ADMIN 状态', async () => {
      const prisma = buildPrismaMock()
      prisma.user.findUnique.mockResolvedValue(buildUser({ id: 3, role: UserRole.ADMIN }))
      const svc = createService(prisma)

      await expect(
        svc.updateStatus(3, { status: UserStatus.DEACTIVATED }, buildOperator({ id: 99, role: UserRole.USER })),
      ).rejects.toThrow(BusinessException)
    })
  })

  // ── remove() ──────────────────────────────────────────────────────────────

  describe('remove()', () => {
    it('不能删除自身账号', async () => {
      const prisma = buildPrismaMock()
      prisma.user.findUnique.mockResolvedValue(buildUser({ id: 7, role: UserRole.USER }))
      const svc = createService(prisma)

      await expect(svc.remove(7, buildOperator({ id: 7, role: UserRole.ADMIN }))).rejects.toThrow(BusinessException)
    })

    it('ADMIN 可删除 USER', async () => {
      const prisma = buildPrismaMock()
      const target = buildUser({ id: 3, role: UserRole.USER })
      prisma.user.findUnique.mockResolvedValue(target)
      prisma.user.update.mockResolvedValue(target)
      const svc = createService(prisma)

      await svc.remove(3, buildOperator({ id: 99, role: UserRole.ADMIN }))

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 3 }, data: { status: UserStatus.DELETED } }),
      )
    })

    it('不能删除 SUPER_ADMIN', async () => {
      const prisma = buildPrismaMock()
      prisma.user.findUnique.mockResolvedValue(buildUser({ id: 1, role: UserRole.SUPER_ADMIN }))
      const svc = createService(prisma)

      await expect(svc.remove(1, buildOperator({ id: 99, role: UserRole.SUPER_ADMIN }))).rejects.toThrow(
        BusinessException,
      )
    })
  })

  // ── hasHigherRole() (私有方法) ─────────────────────────────────────────────

  describe('hasHigherRole() [private]', () => {
    let svc: UserService

    beforeEach(() => {
      svc = createService()
    })

    it('SUPER_ADMIN > ADMIN', () => {
      expect((svc as any).hasHigherRole(UserRole.SUPER_ADMIN, UserRole.ADMIN)).toBe(true)
    })

    it('ADMIN > USER', () => {
      expect((svc as any).hasHigherRole(UserRole.ADMIN, UserRole.USER)).toBe(true)
    })

    it('USER 不高于 ADMIN', () => {
      expect((svc as any).hasHigherRole(UserRole.USER, UserRole.ADMIN)).toBe(false)
    })

    it('同级不算高于', () => {
      expect((svc as any).hasHigherRole(UserRole.ADMIN, UserRole.ADMIN)).toBe(false)
    })
  })

  // ── auditLog 记录 ─────────────────────────────────────────────────────────

  describe('审计日志', () => {
    it('create 成功后记录 USER_CREATE 审计日志', async () => {
      const prisma = buildPrismaMock()
      const audit = buildAuditLogMock()
      prisma.user.findUnique.mockResolvedValue(null)
      prisma.user.create.mockResolvedValue(buildUser())
      const svc = createService(prisma, audit)

      await svc.create(
        { account: 'new', password: 'pass', nickname: 'n', role: UserRole.USER },
        buildOperator({ role: UserRole.ADMIN }),
      )

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.USER_CREATE }),
      )
    })
  })
})
