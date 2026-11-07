import { describe, it, expect } from 'bun:test';
import { OutboxMessage } from '../../../src/domain/outbox/outbox-message.js';
import {
  WagerTransactionProcessed,
  WalletBalanceChanged,
} from '../../../src/domain/events/integration-event.js';
import { WagerTransactionKind } from '../../../src/domain/wagering/wager-transaction.js';
import { LedgerDirection } from '../../../src/domain/ledger/wallet-ledger-entry.js';

describe('OutboxMessage', () => {
  it('deve enfileirar um evento de integração com estado inicial correto', () => {
    const event = new WagerTransactionProcessed({
      eventId: 'evt-1',
      aggregateId: 'tx-1',
      correlationId: 'corr-1',
      occurredAt: new Date(),
      data: {
        transactionId: 'tx-1',
        providerId: 'provider-a',
        externalTransactionId: 'ext-1',
        walletId: 'wal-1',
        playerId: 'play-1',
        roundId: 'round-1',
        gameId: 'game-1',
        kind: WagerTransactionKind.Bet,
        money: { amount: '25.00', currency: 'BRL' },
      },
    });

    const outbox = OutboxMessage.enqueue(event);

    expect(outbox.id).toBeDefined();
    expect(outbox.aggregateId).toBe('tx-1');
    expect(outbox.eventType).toBe('WagerTransactionProcessed');
    expect(outbox.attempts).toBe(0);
    expect(outbox.isPending()).toBe(true);
    expect(outbox.isDue()).toBe(true);
  });

  it('deve marcar como publicado', () => {
    const event = new WalletBalanceChanged({
      eventId: 'evt-2',
      aggregateId: 'wal-1',
      correlationId: 'corr-2',
      occurredAt: new Date(),
      data: {
        walletId: 'wal-1',
        transactionId: 'tx-2',
        direction: LedgerDirection.Debit,
        money: { amount: '10.00', currency: 'BRL' },
        balanceBefore: { amount: '100.00', currency: 'BRL' },
        balanceAfter: { amount: '90.00', currency: 'BRL' },
        walletVersion: 2,
      },
    });

    const outbox = OutboxMessage.enqueue(event);
    const publishedAt = new Date();
    outbox.markPublished(publishedAt);

    expect(outbox.isPending()).toBe(false);
    expect(outbox.publishedAt).toEqual(publishedAt);
  });

  it('deve agendar retry com backoff exponencial', () => {
    const event = new WagerTransactionProcessed({
      eventId: 'evt-3',
      aggregateId: 'tx-3',
      correlationId: 'corr-3',
      occurredAt: new Date(),
      data: {
        transactionId: 'tx-3',
        providerId: 'provider-a',
        externalTransactionId: 'ext-3',
        walletId: 'wal-1',
        playerId: 'play-1',
        roundId: 'round-1',
        gameId: 'game-1',
        kind: WagerTransactionKind.Win,
        money: { amount: '50.00', currency: 'BRL' },
      },
    });

    const outbox = OutboxMessage.enqueue(event);
    const now = new Date('2026-01-01T12:00:00.000Z');

    outbox.scheduleRetry(now);
    expect(outbox.attempts).toBe(1);
    // Tentativa 1: 2^1 = 2 segundos
    expect(outbox.nextAttemptAt?.toISOString()).toBe('2026-01-01T12:00:02.000Z');

    outbox.scheduleRetry(now);
    expect(outbox.attempts).toBe(2);
    // Tentativa 2: 2^2 = 4 segundos
    expect(outbox.nextAttemptAt?.toISOString()).toBe('2026-01-01T12:00:04.000Z');
  });
});

