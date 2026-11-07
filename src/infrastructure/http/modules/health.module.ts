import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from '../controllers/health.controller.js';
import { MessagingModule } from '../../messaging/messaging.module.js';

@Module({
  imports: [TerminusModule, MessagingModule],
  controllers: [HealthController],
})
export class HealthModule {}

