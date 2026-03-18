import { SetMetadata } from '@nestjs/common'
import { PUBLIC_KEY } from 'src/constant/auth.constant'

/** 标记路由为公开（跳过 JWT 验证） */
export const Public = () => SetMetadata(PUBLIC_KEY, true)
