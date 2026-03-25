import { Type, applyDecorators } from '@nestjs/common'
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger'
import { ResponseModel } from 'src/common/models/response.model'

export function ApiSuccessResponse<TModel extends Type<unknown>>(
  model: TModel,
  options?: { isArray?: boolean; description?: string },
) {
  const dataSchema = options?.isArray
    ? { type: 'array', items: { $ref: getSchemaPath(model) } }
    : { $ref: getSchemaPath(model) }

  return applyDecorators(
    ApiExtraModels(ResponseModel, model),
    ApiOkResponse({
      description: options?.description,
      schema: {
        allOf: [
          { $ref: getSchemaPath(ResponseModel) },
          {
            properties: {
              data: dataSchema,
            },
          },
        ],
      },
    }),
  )
}

export function ApiSuccessRawResponse(dataSchema: Record<string, unknown>, options?: { description?: string }) {
  return applyDecorators(
    ApiExtraModels(ResponseModel),
    ApiOkResponse({
      description: options?.description,
      schema: {
        allOf: [
          { $ref: getSchemaPath(ResponseModel) },
          {
            properties: {
              data: dataSchema,
            },
          },
        ],
      },
    }),
  )
}
