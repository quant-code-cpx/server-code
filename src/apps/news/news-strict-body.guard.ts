import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  Type,
  ValidationPipe,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { NewsIngestionRunRequestDto } from './dto/news-request.dto'

const NEWS_STRICT_BODY_DTO_KEY = 'news:strict-body-dto'
export const NewsStrictBody = (dto: Type<unknown>) => SetMetadata(NEWS_STRICT_BODY_DTO_KEY, dto)

@Injectable()
export class NewsStrictBodyGuard implements CanActivate {
  private readonly pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: false,
    disableErrorMessages: false,
  })

  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const dto = this.reflector.getAllAndOverride<Type<unknown>>(NEWS_STRICT_BODY_DTO_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!dto) return true
    const request = context.switchToHttp().getRequest<{ body?: unknown }>()
    if (dto === NewsIngestionRunRequestDto) assertIngestionBranch(request.body)
    request.body = await this.pipe.transform(request.body ?? {}, { type: 'body', metatype: dto })
    return true
  }
}

function assertIngestionBranch(body: unknown): void {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return
  const value = body as Record<string, unknown>
  const forbidden =
    value.operation === 'POLL_FEED'
      ? ['securityCodes', 'beginDate', 'endDate']
      : value.operation === 'BACKFILL_SECURITY_NOTICES'
        ? ['providerKey', 'feedKey']
        : []
  const mixed = forbidden.filter((key) => Object.prototype.hasOwnProperty.call(value, key))
  if (mixed.length) {
    throw new BadRequestException([`operation=${String(value.operation)} 不允许字段: ${mixed.join(', ')}`])
  }
}
