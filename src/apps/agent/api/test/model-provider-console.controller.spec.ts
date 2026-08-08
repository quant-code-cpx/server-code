import { UserRole } from '@prisma/client'
import { ROLES_KEY } from 'src/common/decorators/roles.decorator'
import { ModelProviderConsoleController } from '../model-provider-console.controller'

describe('ModelProviderConsoleController', () => {
  it('模型供应商控制面只允许超级管理员访问', () => {
    expect(Reflect.getMetadata(ROLES_KEY, ModelProviderConsoleController)).toEqual([UserRole.SUPER_ADMIN])
  })

  it('所有 POST 入口都把完整 DTO 或资源 ID 委托给控制面服务', async () => {
    const result = { ok: true }
    const consoleService = {
      listAdapters: jest.fn().mockReturnValue(result),
      listConnections: jest.fn().mockResolvedValue(result),
      createConnection: jest.fn().mockResolvedValue(result),
      updateConnection: jest.fn().mockResolvedValue(result),
      testConnection: jest.fn().mockResolvedValue(result),
      connectionDeleteImpact: jest.fn().mockResolvedValue(result),
      deleteConnection: jest.fn().mockResolvedValue(result),
      listDeployments: jest.fn().mockResolvedValue(result),
      createDeployment: jest.fn().mockResolvedValue(result),
      updateDeployment: jest.fn().mockResolvedValue({
        deployment: result,
        previousEnabled: false,
        routingChanged: false,
      }),
      probeDeployment: jest.fn().mockResolvedValue(result),
      deploymentDeleteImpact: jest.fn().mockResolvedValue(result),
      deleteDeployment: jest.fn().mockResolvedValue(result),
      consoleSummary: jest.fn().mockResolvedValue(result),
      assertPublishable: jest.fn().mockResolvedValue(undefined),
      createPublishedVersion: jest.fn().mockResolvedValue({ activeVersion: 'modelcfg-1' }),
    }
    const registry = {
      validateDraft: jest.fn().mockResolvedValue(undefined),
      reload: jest.fn().mockResolvedValue(undefined),
    }
    const controller = new ModelProviderConsoleController(consoleService as never, registry as never)
    const connectionDto = { id: 'connection-1', version: 3 }
    const deploymentDto = { id: 'deployment-1', version: 5 }

    expect(controller.listAdapters()).toBe(result)
    await expect(controller.listConnections(connectionDto as never)).resolves.toBe(result)
    await expect(controller.createConnection(connectionDto as never)).resolves.toBe(result)
    await expect(controller.updateConnection(connectionDto as never)).resolves.toBe(result)
    await expect(controller.testConnection(connectionDto as never)).resolves.toBe(result)
    await expect(controller.connectionDeleteImpact(connectionDto as never)).resolves.toBe(result)
    await expect(controller.deleteConnection(connectionDto as never)).resolves.toBe(result)
    await expect(controller.listDeployments(deploymentDto as never)).resolves.toBe(result)
    await expect(controller.createDeployment(deploymentDto as never)).resolves.toBe(result)
    await expect(controller.updateDeployment(deploymentDto as never)).resolves.toBe(result)
    await expect(controller.probeDeployment(deploymentDto as never)).resolves.toBe(result)
    await expect(controller.deploymentDeleteImpact(deploymentDto as never)).resolves.toBe(result)
    await expect(controller.deleteDeployment(deploymentDto as never)).resolves.toBe(result)
    await expect(controller.summary()).resolves.toBe(result)

    expect(consoleService.listConnections).toHaveBeenCalledWith(connectionDto)
    expect(consoleService.createConnection).toHaveBeenCalledWith(connectionDto)
    expect(consoleService.updateConnection).toHaveBeenCalledWith(connectionDto)
    expect(consoleService.testConnection).toHaveBeenCalledWith(connectionDto)
    expect(consoleService.connectionDeleteImpact).toHaveBeenCalledWith('connection-1')
    expect(consoleService.deleteConnection).toHaveBeenCalledWith('connection-1')
    expect(consoleService.listDeployments).toHaveBeenCalledWith(deploymentDto)
    expect(consoleService.createDeployment).toHaveBeenCalledWith(deploymentDto)
    expect(consoleService.updateDeployment).toHaveBeenCalledWith(deploymentDto)
    expect(consoleService.probeDeployment).toHaveBeenCalledWith(deploymentDto)
    expect(consoleService.deploymentDeleteImpact).toHaveBeenCalledWith('deployment-1')
    expect(consoleService.deleteDeployment).toHaveBeenCalledWith('deployment-1')
  })

  it('发布按门禁、草稿验证、持久化版本、热加载的顺序原子推进', async () => {
    const consoleService = {
      assertPublishable: jest.fn().mockResolvedValue(undefined),
      createPublishedVersion: jest.fn().mockResolvedValue({ activeVersion: 'modelcfg-1' }),
    }
    const registry = {
      validateDraft: jest.fn().mockResolvedValue(undefined),
      reload: jest.fn().mockResolvedValue(undefined),
    }
    const controller = new ModelProviderConsoleController(consoleService as never, registry as never)

    await expect(controller.publish()).resolves.toEqual({ activeVersion: 'modelcfg-1' })

    expect(consoleService.assertPublishable).toHaveBeenCalledTimes(1)
    expect(registry.validateDraft).toHaveBeenCalledTimes(1)
    expect(consoleService.createPublishedVersion).toHaveBeenCalledTimes(1)
    expect(registry.reload).toHaveBeenCalledTimes(1)
    expect(consoleService.assertPublishable.mock.invocationCallOrder[0]).toBeLessThan(
      registry.validateDraft.mock.invocationCallOrder[0],
    )
    expect(registry.validateDraft.mock.invocationCallOrder[0]).toBeLessThan(
      consoleService.createPublishedVersion.mock.invocationCallOrder[0],
    )
    expect(consoleService.createPublishedVersion.mock.invocationCallOrder[0]).toBeLessThan(
      registry.reload.mock.invocationCallOrder[0],
    )
  })

  it('发布门禁失败时不会创建版本或刷新运行时 Registry', async () => {
    const consoleService = {
      assertPublishable: jest.fn().mockRejectedValue(new Error('草稿不可发布')),
      createPublishedVersion: jest.fn(),
    }
    const registry = { validateDraft: jest.fn(), reload: jest.fn() }
    const controller = new ModelProviderConsoleController(consoleService as never, registry as never)

    await expect(controller.publish()).rejects.toThrow('草稿不可发布')
    expect(registry.validateDraft).not.toHaveBeenCalled()
    expect(consoleService.createPublishedVersion).not.toHaveBeenCalled()
    expect(registry.reload).not.toHaveBeenCalled()
  })

  it('部署启用或停用后自动发布活动版本；发布前失败会回滚启用状态', async () => {
    const deployment = { id: 'deployment-1', version: 6, enabled: true }
    const consoleService = {
      updateDeployment: jest.fn().mockResolvedValue({
        deployment,
        previousEnabled: false,
        routingChanged: true,
      }),
      restoreDeploymentEnabled: jest.fn().mockResolvedValue(undefined),
      assertPublishable: jest.fn().mockResolvedValue(undefined),
      createPublishedVersion: jest.fn().mockResolvedValue({ activeVersion: 'modelcfg-2' }),
    }
    const registry = {
      validateDraft: jest.fn().mockResolvedValue(undefined),
      reload: jest.fn().mockResolvedValue(undefined),
    }
    const controller = new ModelProviderConsoleController(consoleService as never, registry as never)

    await expect(controller.updateDeployment({ id: deployment.id, version: 5, enabled: true } as never)).resolves.toBe(
      deployment,
    )
    expect(consoleService.assertPublishable).toHaveBeenCalledTimes(1)
    expect(registry.validateDraft).toHaveBeenCalledTimes(1)
    expect(consoleService.createPublishedVersion).toHaveBeenCalledTimes(1)
    expect(registry.reload).toHaveBeenCalledTimes(1)
    expect(consoleService.restoreDeploymentEnabled).not.toHaveBeenCalled()

    const disabledDeployment = { id: 'deployment-1', version: 7, enabled: false }
    consoleService.updateDeployment.mockResolvedValueOnce({
      deployment: disabledDeployment,
      previousEnabled: true,
      routingChanged: true,
    })
    await expect(controller.updateDeployment({ id: deployment.id, version: 6, enabled: false } as never)).resolves.toBe(
      disabledDeployment,
    )
    expect(consoleService.createPublishedVersion).toHaveBeenCalledTimes(2)
    expect(registry.reload).toHaveBeenCalledTimes(2)

    consoleService.createPublishedVersion.mockRejectedValueOnce(new Error('草稿不可发布'))
    await expect(
      controller.updateDeployment({ id: deployment.id, version: 5, enabled: true } as never),
    ).rejects.toThrow('草稿不可发布')
    expect(consoleService.restoreDeploymentEnabled).toHaveBeenCalledWith(deployment.id, deployment.version, false)
  })
})
