import { ModelProviderAdminController } from '../model-provider-admin.controller'
import { ROLES_KEY } from 'src/common/decorators/roles.decorator'
import { UserRole } from '@prisma/client'

describe('ModelProviderAdminController', () => {
  it('仅允许超级管理员访问', () => {
    expect(Reflect.getMetadata(ROLES_KEY, ModelProviderAdminController)).toEqual([UserRole.SUPER_ADMIN])
  })

  it('新增、删除和刷新都委托配置服务并刷新注册表', async () => {
    const configs = {
      listAdmin: jest.fn().mockResolvedValue({ items: [] }),
      create: jest.fn().mockResolvedValue({ id: 'provider-1' }),
      update: jest.fn().mockResolvedValue({ id: 'provider-1' }),
      remove: jest.fn().mockResolvedValue({ id: 'provider-1', deleted: true }),
    }
    const registry = {
      reload: jest.fn().mockResolvedValue(undefined),
      list: jest.fn().mockReturnValue([{ model: 'model-1' }]),
    }
    const controller = new ModelProviderAdminController(configs as never, registry as never)

    await controller.create({} as never)
    await controller.update({ id: 'provider-1' } as never)
    await controller.delete({ id: 'provider-1' })
    await controller.reload()

    expect(configs.create).toHaveBeenCalled()
    expect(configs.update).toHaveBeenCalled()
    expect(configs.remove).toHaveBeenCalledWith({ id: 'provider-1' })
    expect(registry.reload).toHaveBeenCalledTimes(4)
  })
})
