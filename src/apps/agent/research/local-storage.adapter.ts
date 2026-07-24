import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { Injectable } from '@nestjs/common'
import { AgentReportConfig, type IAgentReportConfig } from 'src/config/agent-report.config'
import { Inject } from '@nestjs/common'
import type { ResearchReportStoragePort, StoredResearchReportArtifact } from './storage.port'

@Injectable()
export class LocalResearchReportStorage implements ResearchReportStoragePort {
  private readonly root: string

  constructor(@Inject(AgentReportConfig.KEY) config: IAgentReportConfig) {
    if (config.storageDriver !== 'local') {
      throw new Error('当前仅启用 local Agent report storage；S3 由部署批次提供 adapter')
    }
    this.root = resolve(config.localStoragePath)
  }

  async put(key: string, content: Buffer): Promise<StoredResearchReportArtifact> {
    const path = this.pathFor(key)
    await mkdir(dirname(path), { recursive: true })
    const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`
    await writeFile(temporaryPath, content, { mode: 0o600 })
    await rename(temporaryPath, path)
    return {
      key,
      hash: createHash('sha256').update(content).digest('hex'),
      size: content.byteLength,
    }
  }

  get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key))
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true })
  }

  private pathFor(key: string): string {
    if (!/^reports\/\d+\/[A-Za-z0-9_-]{1,32}\/[a-f0-9]{64}\.html$/.test(key)) {
      throw new Error('报告 storage key 非法')
    }
    const path = resolve(this.root, key)
    if (!path.startsWith(`${this.root}${sep}`)) throw new Error('报告 storage key 越界')
    return path
  }
}
