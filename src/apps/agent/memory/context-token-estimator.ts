import { Injectable } from '@nestjs/common'

@Injectable()
export class ContextTokenEstimator {
  estimateText(value: string): number {
    let asciiCharacters = 0
    let nonAsciiCodePoints = 0
    for (const character of value) {
      if (character.codePointAt(0)! <= 0x7f) asciiCharacters += 1
      else nonAsciiCodePoints += 1
    }
    return Math.ceil(asciiCharacters / 4) + nonAsciiCodePoints
  }

  estimateMessages(messages: readonly { role?: string; content: string }[]): number {
    return messages.reduce((total, message) => total + 4 + this.estimateText(message.content), 0)
  }
}
