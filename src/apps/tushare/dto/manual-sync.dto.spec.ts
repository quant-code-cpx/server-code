import { validate } from 'class-validator'
import { TushareSyncTaskName } from 'src/constant/tushare.constant'
import { ManualSyncDto } from './manual-sync.dto'

describe('ManualSyncDto', () => {
  it('accepts a valid mode and task list', async () => {
    const dto = new ManualSyncDto()
    dto.mode = 'full'
    dto.tasks = [TushareSyncTaskName.DAILY, TushareSyncTaskName.DIVIDEND]

    await expect(validate(dto)).resolves.toHaveLength(0)
  })

  it('rejects an invalid mode', async () => {
    const dto = new ManualSyncDto()
    dto.mode = 'invalid' as never

    const errors = await validate(dto)
    expect(errors).toHaveLength(1)
  })

  it('rejects an invalid task', async () => {
    const dto = new ManualSyncDto()
    dto.mode = 'incremental'
    dto.tasks = ['INVALID_TASK' as never]

    const errors = await validate(dto)
    expect(errors).toHaveLength(1)
  })
})
