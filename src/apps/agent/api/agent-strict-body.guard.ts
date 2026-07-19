import { CanActivate, ExecutionContext, Injectable, Type, ValidationPipe } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { AGENT_STRICT_BODY_DTO_KEY } from './strict-agent-body.decorator'

@Injectable()
export class AgentStrictBodyGuard implements CanActivate {
  private readonly pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    disableErrorMessages: false,
  })

  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const dto = this.reflector.getAllAndOverride<Type<unknown>>(AGENT_STRICT_BODY_DTO_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!dto) return true
    const request = context.switchToHttp().getRequest<{ body?: unknown }>()
    request.body = await this.pipe.transform(request.body ?? {}, { type: 'body', metatype: dto })
    return true
  }
}
