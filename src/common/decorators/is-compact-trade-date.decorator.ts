import { registerDecorator, type ValidationArguments, type ValidationOptions } from 'class-validator'
import { parseCompactTradeDateToUtcDate } from 'src/common/utils/trade-date.util'

/** Validates the project-standard Shanghai trade-date wire format: YYYYMMDD. */
export function IsCompactTradeDate(validationOptions?: ValidationOptions) {
  return (target: object, propertyName: string) => {
    registerDecorator({
      target: target.constructor,
      propertyName,
      options: validationOptions,
      name: 'isCompactTradeDate',
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string') return false
          try {
            parseCompactTradeDateToUtcDate(value, propertyName)
            return true
          } catch {
            return false
          }
        },
        defaultMessage(arguments_: ValidationArguments) {
          return `${arguments_.property} 格式应为有效的 YYYYMMDD 日期`
        },
      },
    })
  }
}
