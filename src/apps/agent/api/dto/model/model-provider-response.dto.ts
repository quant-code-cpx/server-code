import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class ModelProviderAdminResponseDto {
  @ApiProperty() id: string
  @ApiProperty({ description: '供应商标识；同一供应商可对应多个模型配置' }) providerId: string
  @ApiProperty() kind: string
  @ApiProperty() displayName: string
  @ApiProperty() model: string
  @ApiProperty() priority: number
  @ApiProperty() costTier: string
  @ApiPropertyOptional({ nullable: true }) baseUrl: string | null
  @ApiProperty() apiKeyConfigured: boolean
  @ApiPropertyOptional({ nullable: true }) apiKeyLastFour: string | null
  @ApiProperty() contextWindow: number
  @ApiProperty() maxOutputTokens: number
  @ApiProperty({ type: String, isArray: true }) capabilities: string[]
  @ApiProperty({ type: String, isArray: true }) reasoningEfforts: string[]
  @ApiProperty({ type: String, isArray: true }) dataClasses: string[]
  @ApiProperty() timeoutMs: number
  @ApiProperty() maxRetries: number
  @ApiProperty() retryBaseMs: number
  @ApiProperty() enabled: boolean
  @ApiProperty() createdAt: string
  @ApiProperty() updatedAt: string
}

export class ModelProviderListResponseDto {
  @ApiProperty({ type: ModelProviderAdminResponseDto, isArray: true })
  items: ModelProviderAdminResponseDto[]
}

export class ModelProviderDeleteResponseDto {
  @ApiProperty() id: string
  @ApiProperty() deleted: boolean
}
