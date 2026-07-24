import { Inject, Injectable } from '@nestjs/common'
import { ShutdownConfig, type IShutdownConfig } from 'src/config/shutdown.config'
import { LoggerService } from 'src/shared/logger/logger.service'

/** Tracks whether API instance may receive new traffic during graceful shutdown. */
@Injectable()
export class ReadinessService {
  private acceptingTraffic = true
  private drainingStartedAt: number | null = null

  constructor(
    @Inject(ShutdownConfig.KEY) private readonly config: IShutdownConfig,
    private readonly logger: LoggerService,
  ) {}

  isAcceptingTraffic(): boolean {
    return this.acceptingTraffic
  }

  beginDraining(signal?: string): void {
    if (this.drainingStartedAt !== null) return

    this.acceptingTraffic = false
    this.drainingStartedAt = Date.now()
    this.logger.log(
      { operation: 'shutdown.drainStarted', signal: signal ?? 'unknown', graceMs: this.config.graceMs },
      ReadinessService.name,
    )
  }

  async waitForDrainGracePeriod(): Promise<void> {
    if (this.drainingStartedAt === null) return

    const remainingMs = this.config.graceMs - (Date.now() - this.drainingStartedAt)
    if (remainingMs > 0) await delay(remainingMs)

    this.logger.log({ operation: 'shutdown.drainCompleted' }, ReadinessService.name)
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
