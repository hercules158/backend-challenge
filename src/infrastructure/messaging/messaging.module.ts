import { Module, OnModuleInit } from '@nestjs/common';
import { SqsService } from './sqs/sqs.service.js';
import { SqsEventPublisher } from './sqs/sqs-event.publisher.js';
import { SqsConsumerService } from './sqs/sqs-consumer.service.js';
import { OutboxModule } from '../outbox/outbox.module.js';
import { OutboxWorker } from '../outbox/outbox.worker.js';
import { WageringModule } from '../http/modules/wagering.module.js';

@Module({
  imports: [OutboxModule, WageringModule],
  providers: [
    SqsService,
    SqsEventPublisher,
    SqsConsumerService,
  ],
  exports: [
    SqsService,
    SqsEventPublisher,
    SqsConsumerService,
  ],
})
export class MessagingModule implements OnModuleInit {
  constructor(
    private readonly outboxWorker: OutboxWorker,
    private readonly publisher: SqsEventPublisher,
  ) {}

  onModuleInit() {
    // Conecta o SqsEventPublisher ao OutboxWorker
    this.outboxWorker.setPublisher(this.publisher);
  }
}
