export interface StoredResearchReportArtifact {
  key: string
  hash: string
  size: number
}

export interface ResearchReportStoragePort {
  put(key: string, content: Buffer): Promise<StoredResearchReportArtifact>
  get(key: string): Promise<Buffer>
  delete(key: string): Promise<void>
}

export const AGENT_REPORT_STORAGE = Symbol('AGENT_REPORT_STORAGE')
