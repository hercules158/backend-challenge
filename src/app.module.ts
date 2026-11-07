import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { WalletModule } from './infrastructure/http/modules/wallet.module.js';
import { WageringModule } from './infrastructure/http/modules/wagering.module.js';
import { HealthModule } from './infrastructure/http/modules/health.module.js';
import config from './infrastructure/database/mikro-orm/mikro-orm.config.js';

@Module({
  imports: [
    MikroOrmModule.forRoot(config),
    HealthModule,
    WalletModule,
    WageringModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
