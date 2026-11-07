import { Injectable, Logger } from '@nestjs/common';
import type { IEventPublisher } from '../../outbox/outbox.worker.js';
import { SqsService } from './sqs.service.js';

@Injectable()
export class SqsEventPublisher implements IEventPublisher {
  private readonly logger = new Logger(SqsEventPublisher.name);

  constructor(private readonly sqsService: SqsService) {}

  async publish(eventType: string, payload: Record<string, unknown>): Promise<void> {
    // Para filas FIFO, MessageGroupId é essencial para particionar/ordenar por wallet
    // O aggregateId ou walletId vem no payload serializado
    const walletId =
      (payload.aggregateId as string) ||
      (payload.data && typeof payload.data === 'object' && (payload.data as any).walletId) ||
      'default-group';

    const eventId = (payload.eventId as string) || (payload.id as string) || `${Date.now()}-${Math.random()}`;

    const body = JSON.stringify({
      eventType,
      ...payload,
    });

    await this.sqsService.sendMessage({
      messageBody: body,
      messageGroupId: walletId,
      messageDeduplicationId: eventId,
    });

    this.logger.debug(`Published outbox event ${eventType} (${eventId}) to SQS FIFO`);
  }
}

