import { randomUUID } from 'node:crypto';
import { IntegrationEvent } from '../events/integration-event.js';

export interface OutboxMessageState {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: Readonly<Record<string, unknown>>;
  occurredAt: Date;
  attempts: number;
  nextAttemptAt?: Date;
  publishedAt?: Date;
}

export class OutboxMessage {
  private constructor(
    public readonly id: string,
    public readonly aggregateId: string,
    public readonly eventType: string,
    public readonly payload: Readonly<Record<string, unknown>>,
    public readonly occurredAt: Date,
    private _attempts: number,
    private _nextAttemptAt?: Date,
    private _publishedAt?: Date,
  ) {}

  /**
   * Cria uma nova mensagem outbox pronta para ser persistida.
   */
  static enqueue(event: IntegrationEvent<unknown>): OutboxMessage {
    return new OutboxMessage(
      randomUUID(),
      event.aggregateId,
      event.eventType,
      event.toJSON(),
      event.occurredAt,
      0,
      new Date(), // Imediatamente pronta para envio
      undefined,
    );
  }

  /**
   * Reconstrução a partir do banco de dados (não revalida regras).
   */
  static rehydrate(state: OutboxMessageState): OutboxMessage {
    return new OutboxMessage(
      state.id,
      state.aggregateId,
      state.eventType,
      state.payload,
      state.occurredAt,
      state.attempts,
      state.nextAttemptAt,
      state.publishedAt,
    );
  }

  get attempts(): number {
    return this._attempts;
  }

  get nextAttemptAt(): Date | undefined {
    return this._nextAttemptAt;
  }

  get publishedAt(): Date | undefined {
    return this._publishedAt;
  }

  isPending(): boolean {
    return this._publishedAt === undefined;
  }

  isDue(now: Date = new Date()): boolean {
    if (!this.isPending()) return false;
    if (!this._nextAttemptAt) return true;
    return this._nextAttemptAt.getTime() <= now.getTime();
  }

  markPublished(at: Date = new Date()): void {
    this._publishedAt = at;
  }

  /**
   * Incrementa attempts e agenda a próxima tentativa com backoff exponencial.
   * Exemplo: tentativa 1 -> 2s, tentativa 2 -> 4s, tentativa 3 -> 8s... (teto de 60s)
   */
  scheduleRetry(now: Date = new Date()): void {
    this._attempts++;
    const delaySeconds = Math.min(Math.pow(2, this._attempts), 60);
    this._nextAttemptAt = new Date(now.getTime() + delaySeconds * 1000);
  }
}

