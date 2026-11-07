import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { WalletModule } from './infrastructure/http/modules/wallet.module.js';
import config from './infrastructure/database/mikro-orm/mikro-orm.config.js';

@Module({
  imports: [
    MikroOrmModule.forRoot(config),
    WalletModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
