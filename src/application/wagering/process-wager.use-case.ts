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

    // 2. Transação SQL Atômica com Lock Pessimista na Wallet
    return await this.em.transactional(async (em) => {
      // Busca a wallet com LockMode.PESSIMISTIC_WRITE (SELECT ... FOR UPDATE)
      // garantindo que nenhuma outra instância altere o saldo ao mesmo tempo
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

      // Cria a entidade de WagerTransaction em memória
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
          // Referência ainda não existe (fora de ordem)
          transaction.markPendingReference();

          const txOrm = em.create(WagerTransactionOrmEntity, this.toOrmProps(transaction));
          em.persist(txOrm);

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
          // Rollback: inverte o efeito contábil da transação referenciada
          if (referenceTx!.kind === WagerTransactionKind.Bet) {
            balanceChange = wallet.credit(money);
          } else if (referenceTx!.kind === WagerTransactionKind.Win) {
            balanceChange = wallet.debit(money);
          }
        }
        // Nota: LOSS não afeta saldo (affectsBalance = false)

        transaction.markProcessed(referenceTx?.id, new Date());

        // Atualiza a Wallet no banco
        walletOrm.balanceAmount = wallet.balance.toString();
        walletOrm.version = wallet.version;
        walletOrm.updatedAt = wallet.updatedAt;

        // Se moveu saldo, gera o lançamento contábil no Ledger
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
        }

        const txOrm = em.create(WagerTransactionOrmEntity, this.toOrmProps(transaction));
        em.persist(txOrm);

        return {
          transactionId: transaction.id,
          status: transaction.status,
          balance: wallet.balance.toJSON(),
          idempotentReplay: false,
        };
      } catch (err: any) {
        // Se a regra de saldo falhar (ex: saldo insuficiente)
        if (err.name === 'InsufficientFundsError') {
          transaction.reject(FailureCode.InsufficientFunds);

          const txOrm = em.create(WagerTransactionOrmEntity, this.toOrmProps(transaction));
          em.persist(txOrm);

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
