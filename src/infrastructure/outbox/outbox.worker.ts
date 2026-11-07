import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { OutboxMessageOrmEntity } from '../database/mikro-orm/entities/outbox-message.orm-entity.js';
import { OutboxMessage } from '../../domain/outbox/outbox-message.js';

export interface IEventPublisher {
  publish(eventType: string, payload: Record<string, unknown>): Promise<void>;
}

@Injectable()
export class OutboxWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxWorker.name);
  private timer?: NodeJS.Timeout;
  private isRunning = false;
  private publisher?: IEventPublisher;

  constructor(private readonly em: EntityManager) {}

  setPublisher(publisher: IEventPublisher) {
    this.publisher = publisher;
  }

  onModuleInit() {
    this.start();
  }

  onModuleDestroy() {
    this.stop();
  }

  start(intervalMs = 1000) {
    this.timer = setInterval(() => {
      this.processOutboxBatch().catch(err => {
        this.logger.error(`Error processing outbox batch: ${err.message}`, err.stack);
      });
    }, intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  /**
   * Processa um lote de mensagens usando FOR UPDATE SKIP LOCKED
   * Garantindo concorrência perfeita entre múltiplas instâncias
   */
  async processOutboxBatch(batchSize = 50): Promise<number> {
    if (this.isRunning) return 0;
    this.isRunning = true;

    try {
      return await this.em.fork().transactional(async (forkEm) => {
        // Query com SKIP LOCKED para concorrência entre réplicas
        const knex = forkEm.getKnex();
        const rows = await knex('outbox_messages')
          .whereNull('published_at')
          .andWhere(function () {
            this.whereNull('next_attempt_at').orWhere('next_attempt_at', '<=', new Date());
          })
          .orderBy('occurred_at', 'asc')
          .limit(batchSize)
          .forUpdate()
          .skipLocked();

        if (!rows || rows.length === 0) {
          return 0;
        }

        const now = new Date();

        for (const row of rows) {
          const outbox = OutboxMessage.rehydrate({
            id: row.id,
            aggregateId: row.aggregate_id,
            eventType: row.event_type,
            payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
            occurredAt: new Date(row.occurred_at),
            attempts: row.attempts,
            nextAttemptAt: row.next_attempt_at ? new Date(row.next_attempt_at) : undefined,
            publishedAt: row.published_at ? new Date(row.published_at) : undefined,
          });

          try {
            // Se tiver publisher conectado (SQS no passo 3), publica:
            if (this.publisher) {
              await this.publisher.publish(outbox.eventType, outbox.payload as Record<string, unknown>);
            } else {
              this.logger.log(`[Outbox] Event ready: ${outbox.eventType} (${outbox.id})`);
            }

            outbox.markPublished(now);

            await forkEm.getKnex()('outbox_messages')
              .where({ id: outbox.id })
              .update({
                published_at: outbox.publishedAt,
                attempts: outbox.attempts,
              });
          } catch (pubError: any) {
            this.logger.warn(
              `Failed to publish outbox message ${outbox.id}: ${pubError.message}. Scheduling retry...`,
            );
            outbox.scheduleRetry(now);

            await forkEm.getKnex()('outbox_messages')
              .where({ id: outbox.id })
              .update({
                attempts: outbox.attempts,
                next_attempt_at: outbox.nextAttemptAt,
              });
          }
        }

        return rows.length;
      });
    } finally {
      this.isRunning = false;
    }
  }
}

