import { Injectable } from '@nestjs/common'
import { estimateTextTokens } from '../model-gateway/model-token-estimator'

@Injectable()
export class ContextTokenEstimator {
  estimateText(value: string): number {
    return estimateTextTokens(value)
  }

  estimateMessages(messages: readonly { role?: string; content: string }[]): number {
    return messages.reduce((total, message) => total + 4 + this.estimateText(message.content), 0)
  }
}
