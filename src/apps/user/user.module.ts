import { Module } from '@nestjs/common'
import { UserService } from './user.service'
import { UserController } from './user.controller'
import { AuditLogService } from './audit-log.service'

@Module({
  controllers: [UserController],
  providers: [UserService, AuditLogService],
  exports: [UserService],
})
export class UserModule {}
