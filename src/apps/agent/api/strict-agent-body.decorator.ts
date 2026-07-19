import { SetMetadata, type Type } from '@nestjs/common'

export const AGENT_STRICT_BODY_DTO_KEY = 'agent:strict-body-dto'

export function StrictAgentBody(dto: Type<unknown>) {
  return SetMetadata(AGENT_STRICT_BODY_DTO_KEY, dto)
}
