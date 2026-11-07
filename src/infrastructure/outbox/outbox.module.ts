import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { OutboxWorker } from './outbox.worker.js';
import { OutboxMessageOrmEntity } from '../database/mikro-orm/entities/outbox-message.orm-entity.js';

@Module({
  imports: [
    MikroOrmModule.forFeature([OutboxMessageOrmEntity]),
  ],
  providers: [OutboxWorker],
  exports: [OutboxWorker],
})
export class OutboxModule {}

