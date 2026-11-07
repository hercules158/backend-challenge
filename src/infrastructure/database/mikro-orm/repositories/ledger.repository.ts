import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { WalletLedgerEntry } from '../../../../domain/ledger/wallet-ledger-entry.js';
import { LedgerEntryOrmEntity } from '../entities/ledger-entry.orm-entity.js';
import { ILedgerRepository } from '../../../../application/wallet/create-wallet.use-case.js';

@Injectable()
export class MikroOrmLedgerRepository implements ILedgerRepository {
  constructor(private readonly em: EntityManager) {}

  async save(entry: WalletLedgerEntry): Promise<void> {
    const entity = this.em.create(LedgerEntryOrmEntity, {
      id: entry.id,
      walletId: entry.walletId,
      transactionId: entry.transactionId,
      direction: entry.direction,
      moneyAmount: entry.money.toString(),
      currency: entry.money.currency,
      balanceBeforeAmount: entry.balanceBefore.toString(),
      balanceAfterAmount: entry.balanceAfter.toString(),
      createdAt: entry.createdAt,
    });

    this.em.persist(entity);
    await this.em.flush();
  }
}

