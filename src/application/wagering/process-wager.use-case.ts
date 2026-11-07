import { Injectable, Inject } from '@nestjs/common';
import { EntityManager, LockMode } from '@mikro-orm/postgresql';
import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { Money, MoneyProps } from '../../domain/shared/money.js';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
  FailureCode,
} from '../../domain/wagering/wager-transaction.js';
import {
  type IWagerTransactionRepository,
  WAGER_TRANSACTION_REPOSITORY_TOKEN,
} from '../../domain/wagering/wager-transaction.repository.interface.js';
import {
  type IWalletRepository,
  WALLET_REPOSITORY_TOKEN,
} from '../../domain/wallet/wallet.repository.interface.js';
import { Wallet } from '../../domain/wallet/wallet.js';
import { WalletOrmEntity } from '../../infrastructure/database/mikro-orm/entities/wallet.orm-entity.js';
import { WalletLedgerEntry } from '../../domain/ledger/wallet-ledger-entry.js';
import { LedgerEntryOrmEntity } from '../../infrastructure/database/mikro-orm/entities/ledger-entry.orm-entity.js';
import { WagerTransactionOrmEntity } from '../../infrastructure/database/mikro-orm/entities/wager-transaction.orm-entity.js';
import { OutboxMessageOrmEntity } from '../../infrastructure/database/mikro-orm/entities/outbox-message.orm-entity.js';
import { InboxMessageOrmEntity } from '../../infrastructure/database/mikro-orm/entities/inbox-message.orm-entity.js';
import {
  IntegrationEvent,
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WalletBalanceChanged,
  WagerTransactionPendingReference,
} from '../../domain/events/integration-event.js';
import { OutboxMessage } from '../../domain/outbox/outbox-message.js';

// ─── DTOs ─────────────────────────────────────────────────────

export interface ProcessWagerInput {
  idempotencyKey: string;
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  referenceExternalTransactionId?: string;
  correlationId?: string;
  causationId?: string;
  inboxMessageId?: string;
  consumerName?: string;
}

export interface ProcessWagerOutput {
  transactionId: string;
  status: WagerTransactionStatus;
  balance: MoneyProps;
  idempotentReplay: boolean;
  failureCode?: FailureCode;
}

// ─── Erros Específicos ────────────────────────────────────────

export class IdempotencyConflictError extends Error {
  constructor(idempotencyKey: string) {
    super(`Idempotency key ${idempotencyKey} was already used with a different payload`);
    this.name = 'IdempotencyConflictError';
  }
}

export class WalletNotFoundError extends Error {
  constructor(walletId: string) {
    super(`Wallet ${walletId} not found`);
    this.name = 'WalletNotFoundError';
  }
}

// ─── O CASO DE USO ────────────────────────────────────────────

@Injectable()
export class ProcessWagerUseCase {
  constructor(
    private readonly em: EntityManager,
    @Inject(WAGER_TRANSACTION_REPOSITORY_TOKEN)
    private readonly wagerRepo: IWagerTransactionRepository,
    @Inject(WALLET_REPOSITORY_TOKEN)
    private readonly walletRepo: IWalletRepository,
  ) {}

  /**
   * Calcula o hash canônico do payload de negócio (README Seção 9)
   */
  public computePayloadHash(input: ProcessWagerInput): string {
    const canonicalObject = {
      externalTransactionId: input.externalTransactionId,
      gameId: input.gameId,
      kind: input.kind,
      money: {
        amount: input.money.amount,
        currency: input.money.currency,
      },
      playerId: input.playerId,
      providerId: input.providerId,
      referenceExternalTransactionId: input.referenceExternalTransactionId || null,
      roundId: input.roundId,
      walletId: input.walletId,
    };

    return createHash('sha256')
      .update(JSON.stringify(canonicalObject))
      .digest('hex');
  }

  async execute(input: ProcessWagerInput): Promise<ProcessWagerOutput> {
    const payloadHash = this.computePayloadHash(input);
    const correlationId = input.correlationId || randomUUID();

    // 1. Verificação prévia de Idempotência
    const existing = await this.wagerRepo.findByIdempotencyKey(input.idempotencyKey);
    if (existing) {
      if (!existing.matchesPayload(payloadHash)) {
        throw new IdempotencyConflictError(input.idempotencyKey);
      }

      // Replay idempotente: busca a carteira para retornar o saldo atual
      const wallet = await this.walletRepo.findById(existing.walletId);
      return {
        transactionId: existing.id,
        status: existing.status,
        balance: wallet ? wallet.balance.toJSON() : existing.money.toJSON(),
        idempotentReplay: true,
        failureCode: existing.failureCode,
      };
    }

    const money = Money.from(input.money);
    const transactionId = randomUUID();

    // 2. Transação SQL Atômica: Wallet + Transação + Ledger + Outbox (+ Inbox se mensagem SQS)
    return await this.em.fork().transactional(async (em) => {
      // Se veio via consumidor de mensageria, registra a mensagem no Inbox
      if (input.inboxMessageId && input.consumerName) {
        const inboxEntity = em.create(InboxMessageOrmEntity, {
          id: randomUUID(),
          messageId: input.inboxMessageId,
          consumerName: input.consumerName,
          payloadHash,
          receivedAt: new Date(),
          processedAt: new Date(),
        });
        em.persist(inboxEntity);
      }
      // Busca a wallet com LockMode.PESSIMISTIC_WRITE (SELECT ... FOR UPDATE)
      const walletOrm = await em.findOne(
        WalletOrmEntity,
        { id: input.walletId },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );

      if (!walletOrm) {
        throw new WalletNotFoundError(input.walletId);
      }

      const wallet = Wallet.rehydrate({
        id: walletOrm.id,
        playerId: walletOrm.playerId,
        currency: walletOrm.currency,
        balanceAmount: walletOrm.balanceAmount,
        version: walletOrm.version,
        createdAt: walletOrm.createdAt,
        updatedAt: walletOrm.updatedAt,
      });

      const transaction = WagerTransaction.create({
        id: transactionId,
        providerId: input.providerId,
        externalTransactionId: input.externalTransactionId,
        idempotencyKey: input.idempotencyKey,
        payloadHash,
        walletId: input.walletId,
        playerId: input.playerId,
        roundId: input.roundId,
        gameId: input.gameId,
        kind: input.kind,
        money,
        referenceExternalTransactionId: input.referenceExternalTransactionId,
      });

      let referenceTx: WagerTransactionOrmEntity | null = null;

      // Resolução de referência se for REFUND ou ROLLBACK
      if (transaction.requiresReference()) {
        referenceTx = await em.findOne(WagerTransactionOrmEntity, {
          providerId: input.providerId,
          externalTransactionId: input.referenceExternalTransactionId!,
        });

        if (!referenceTx) {
          // Referência ainda ausente -> PENDING_REFERENCE
          transaction.markPendingReference();

          const txOrm = em.create(WagerTransactionOrmEntity, this.toOrmProps(transaction));
          em.persist(txOrm);

          // Outbox Event: WagerTransactionPendingReference
          this.enqueueOutboxEvent(
            em,
            new WagerTransactionPendingReference({
              eventId: randomUUID(),
              aggregateId: transaction.id,
              correlationId,
              causationId: input.causationId,
              occurredAt: new Date(),
              data: {
                transactionId: transaction.id,
                providerId: transaction.providerId,
                externalTransactionId: transaction.externalTransactionId,
                referenceExternalTransactionId: input.referenceExternalTransactionId!,
                walletId: wallet.id,
                kind: transaction.kind,
              },
            }),
          );

          return {
            transactionId: transaction.id,
            status: transaction.status,
            balance: wallet.balance.toJSON(),
            idempotentReplay: false,
          };
        }
      }

      // Aplicação da movimentação financeira
      try {
        let balanceChange: { balanceBefore: Money; balanceAfter: Money } | null = null;

        if (input.kind === WagerTransactionKind.Bet) {
          balanceChange = wallet.debit(money);
        } else if (
          input.kind === WagerTransactionKind.Win ||
          input.kind === WagerTransactionKind.Refund
        ) {
          balanceChange = wallet.credit(money);
        } else if (input.kind === WagerTransactionKind.Rollback) {
          if (referenceTx!.kind === WagerTransactionKind.Bet) {
            balanceChange = wallet.credit(money);
          } else if (referenceTx!.kind === WagerTransactionKind.Win) {
            balanceChange = wallet.debit(money);
          }
        }

        transaction.markProcessed(referenceTx?.id, new Date());

        // Atualiza a Wallet
        walletOrm.balanceAmount = wallet.balance.toString();
        walletOrm.version = wallet.version;
        walletOrm.updatedAt = wallet.updatedAt;

        // Se moveu saldo, gera o lançamento no Ledger e o evento WalletBalanceChanged
        if (balanceChange) {
          const ledgerEntry = WalletLedgerEntry.create({
            id: randomUUID(),
            walletId: wallet.id,
            transactionId: transaction.id,
            direction: transaction.ledgerDirectionFor(
              referenceTx
                ? WagerTransaction.rehydrate({
                    ...referenceTx,
                    money: Money.from({ amount: referenceTx.moneyAmount, currency: referenceTx.currency }),
                  })
                : undefined,
            ),
            money,
            balanceBefore: balanceChange.balanceBefore,
            balanceAfter: balanceChange.balanceAfter,
          });

          const ledgerOrm = em.create(LedgerEntryOrmEntity, {
            id: ledgerEntry.id,
            walletId: ledgerEntry.walletId,
            transactionId: ledgerEntry.transactionId,
            direction: ledgerEntry.direction,
            moneyAmount: ledgerEntry.money.toString(),
            currency: ledgerEntry.money.currency,
            balanceBeforeAmount: ledgerEntry.balanceBefore.toString(),
            balanceAfterAmount: ledgerEntry.balanceAfter.toString(),
            createdAt: ledgerEntry.createdAt,
          });
          em.persist(ledgerOrm);

          // Outbox Event: WalletBalanceChanged (somente quando saldo muda)
          this.enqueueOutboxEvent(
            em,
            new WalletBalanceChanged({
              eventId: randomUUID(),
              aggregateId: wallet.id,
              correlationId,
              causationId: input.causationId,
              occurredAt: new Date(),
              data: {
                walletId: wallet.id,
                transactionId: transaction.id,
                direction: ledgerEntry.direction,
                money: ledgerEntry.money.toJSON(),
                balanceBefore: balanceChange.balanceBefore.toJSON(),
                balanceAfter: balanceChange.balanceAfter.toJSON(),
                walletVersion: wallet.version,
              },
            }),
          );
        }

        const txOrm = em.create(WagerTransactionOrmEntity, this.toOrmProps(transaction));
        em.persist(txOrm);

        // Outbox Event: WagerTransactionProcessed (inclusive para LOSS)
        this.enqueueOutboxEvent(
          em,
          new WagerTransactionProcessed({
            eventId: randomUUID(),
            aggregateId: transaction.id,
            correlationId,
            causationId: input.causationId,
            occurredAt: new Date(),
            data: {
              transactionId: transaction.id,
              providerId: transaction.providerId,
              externalTransactionId: transaction.externalTransactionId,
              walletId: wallet.id,
              playerId: transaction.playerId,
              roundId: transaction.roundId,
              gameId: transaction.gameId,
              kind: transaction.kind,
              money: transaction.money.toJSON(),
              referenceTransactionId: transaction.referenceTransactionId,
            },
          }),
        );

        return {
          transactionId: transaction.id,
          status: transaction.status,
          balance: wallet.balance.toJSON(),
          idempotentReplay: false,
        };
      } catch (err: any) {
        // Se violar regra de saldo (ex: InsufficientFundsError)
        if (err.name === 'InsufficientFundsError') {
          transaction.reject(FailureCode.InsufficientFunds);

          const txOrm = em.create(WagerTransactionOrmEntity, this.toOrmProps(transaction));
          em.persist(txOrm);

          // Outbox Event: WagerTransactionRejected
          this.enqueueOutboxEvent(
            em,
            new WagerTransactionRejected({
              eventId: randomUUID(),
              aggregateId: transaction.id,
              correlationId,
              causationId: input.causationId,
              occurredAt: new Date(),
              data: {
                transactionId: transaction.id,
                providerId: transaction.providerId,
                externalTransactionId: transaction.externalTransactionId,
                walletId: wallet.id,
                playerId: transaction.playerId,
                roundId: transaction.roundId,
                gameId: transaction.gameId,
                kind: transaction.kind,
                money: transaction.money.toJSON(),
                failureCode: FailureCode.InsufficientFunds,
              },
            }),
          );

          return {
            transactionId: transaction.id,
            status: transaction.status,
            balance: wallet.balance.toJSON(),
            idempotentReplay: false,
            failureCode: transaction.failureCode,
          };
        }
        throw err;
      }
    });
  }

  private enqueueOutboxEvent(em: EntityManager, event: IntegrationEvent<unknown>): void {
    const outboxMessage = OutboxMessage.enqueue(event);
    const entity = em.create(OutboxMessageOrmEntity, {
      id: outboxMessage.id,
      aggregateId: outboxMessage.aggregateId,
      eventType: outboxMessage.eventType,
      payload: outboxMessage.payload,
      occurredAt: outboxMessage.occurredAt,
      attempts: outboxMessage.attempts,
      nextAttemptAt: outboxMessage.nextAttemptAt,
      publishedAt: outboxMessage.publishedAt,
    });
    em.persist(entity);
  }

  private toOrmProps(tx: WagerTransaction) {
    return {
      id: tx.id,
      providerId: tx.providerId,
      externalTransactionId: tx.externalTransactionId,
      idempotencyKey: tx.idempotencyKey,
      payloadHash: tx.payloadHash,
      walletId: tx.walletId,
      playerId: tx.playerId,
      roundId: tx.roundId,
      gameId: tx.gameId,
      kind: tx.kind,
      moneyAmount: tx.money.toString(),
      currency: tx.money.currency,
      referenceExternalTransactionId: tx.referenceExternalTransactionId,
      referenceTransactionId: tx.referenceTransactionId,
      status: tx.status,
      failureCode: tx.failureCode,
      createdAt: tx.createdAt,
      processedAt: tx.processedAt,
    };
  }
}
