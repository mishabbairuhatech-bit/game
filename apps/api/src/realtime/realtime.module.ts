import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AppConfigModule } from '../config/config.module';
import { AppConfigService } from '../config/app-config.service';
import { RealtimeGateway } from './realtime.gateway';
import { NotificationsService } from './notifications.service';

@Global()
@Module({
  imports: [
    AppConfigModule,
    JwtModule.registerAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({ secret: config.auth.jwtSecret }),
    }),
  ],
  providers: [RealtimeGateway, NotificationsService],
  exports: [RealtimeGateway, NotificationsService],
})
export class RealtimeModule {}
