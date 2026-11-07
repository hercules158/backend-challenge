import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { IWagerTransactionRepository } from '../../../../domain/wagering/wager-transaction.repository.interface.js';
import { WagerTransaction } from '../../../../domain/wagering/wager-transaction.js';
import { WagerTransactionOrmEntity } from '../entities/wager-transaction.orm-entity.js';
import { Money } from '../../../../domain/shared/money.js';

@Injectable()
export class MikroOrmWagerTransactionRepository implements IWagerTransactionRepository {
  constructor(private readonly em: EntityManager) {}

  async findById(id: string): Promise<WagerTransaction | null> {
    const entity = await this.em.findOne(WagerTransactionOrmEntity, { id });
    if (!entity) return null;
    return this.toDomain(entity);
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<WagerTransaction | null> {
    const entity = await this.em.findOne(WagerTransactionOrmEntity, { idempotencyKey });
    if (!entity) return null;
    return this.toDomain(entity);
  }

  async findByProviderAndExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null> {
    const entity = await this.em.findOne(WagerTransactionOrmEntity, {
      providerId,
      externalTransactionId,
    });
    if (!entity) return null;
    return this.toDomain(entity);
  }

  async save(transaction: WagerTransaction): Promise<void> {
    const existing = await this.em.findOne(WagerTransactionOrmEntity, { id: transaction.id });

    if (existing) {
      existing.status = transaction.status;
      existing.referenceTransactionId = transaction.referenceTransactionId;
      existing.failureCode = transaction.failureCode;
      existing.processedAt = transaction.processedAt;
    } else {
      const entity = this.em.create(WagerTransactionOrmEntity, {
        id: transaction.id,
        providerId: transaction.providerId,
        externalTransactionId: transaction.externalTransactionId,
        idempotencyKey: transaction.idempotencyKey,
        payloadHash: transaction.payloadHash,
        walletId: transaction.walletId,
        playerId: transaction.playerId,
        roundId: transaction.roundId,
        gameId: transaction.gameId,
        kind: transaction.kind,
        moneyAmount: transaction.money.toString(),
        currency: transaction.money.currency,
        referenceExternalTransactionId: transaction.referenceExternalTransactionId,
        referenceTransactionId: transaction.referenceTransactionId,
        status: transaction.status,
        failureCode: transaction.failureCode,
        createdAt: transaction.createdAt,
        processedAt: transaction.processedAt,
      });
      this.em.persist(entity);
    }

    await this.em.flush();
  }

  private toDomain(entity: WagerTransactionOrmEntity): WagerTransaction {
    return WagerTransaction.rehydrate({
      id: entity.id,
      providerId: entity.providerId,
      externalTransactionId: entity.externalTransactionId,
      idempotencyKey: entity.idempotencyKey,
      payloadHash: entity.payloadHash,
      walletId: entity.walletId,
      playerId: entity.playerId,
      roundId: entity.roundId,
      gameId: entity.gameId,
      kind: entity.kind,
      money: Money.from({ amount: entity.moneyAmount, currency: entity.currency }),
      referenceExternalTransactionId: entity.referenceExternalTransactionId,
      createdAt: entity.createdAt,
      status: entity.status,
      referenceTransactionId: entity.referenceTransactionId,
      failureCode: entity.failureCode,
      processedAt: entity.processedAt,
    });
  }
}

