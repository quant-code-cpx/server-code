import { ConfigType, registerAs } from '@nestjs/config'

export const APP_CONFIG_TOKEN = 'app'

export const AppConfig = registerAs(APP_CONFIG_TOKEN, () => ({
  port: parseInt(process.env.PORT, 10) || 3000,
  isDev: process.env.NODE_ENV === 'development',
  globalPrefix: process.env.GLOBAL_PREFIX || 'api',
}))

export type IAppConfig = ConfigType<typeof AppConfig>
