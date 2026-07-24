import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ProcessRoleConfig } from 'src/config/process-role.config'
import { RedisConfig } from 'src/config/redis.config'
import { SharedModule } from 'src/shared/shared.module'
import { EventsGateway } from './events.gateway'
import { SocketIoRedisPublisher } from './socket-io-redis.publisher'

@Module({
  imports: [SharedModule, ConfigModule.forFeature(RedisConfig), ConfigModule.forFeature(ProcessRoleConfig)],
  providers: [SocketIoRedisPublisher, EventsGateway],
  exports: [EventsGateway],
})
export class WebsocketModule {}
