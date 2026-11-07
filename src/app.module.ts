import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { CustomLoggerModule } from './infrastructure/logging/logger.module.js';
import { WalletModule } from './infrastructure/http/modules/wallet.module.js';
import { WageringModule } from './infrastructure/http/modules/wagering.module.js';
import { HealthModule } from './infrastructure/http/modules/health.module.js';
import { OutboxModule } from './infrastructure/outbox/outbox.module.js';
import { MessagingModule } from './infrastructure/messaging/messaging.module.js';
import config from './infrastructure/database/mikro-orm/mikro-orm.config.js';

@Module({
  imports: [
    CustomLoggerModule,
    MikroOrmModule.forRoot(config),
    HealthModule,
    WalletModule,
    WageringModule,
    OutboxModule,
    MessagingModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
