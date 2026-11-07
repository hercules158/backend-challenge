import { Injectable } from '@nestjs/common';
import { EntityManager, QueryOrder } from '@mikro-orm/postgresql';
import { WalletLedgerEntry } from '../../../../domain/ledger/wallet-ledger-entry.js';
import { LedgerEntryOrmEntity } from '../entities/ledger-entry.orm-entity.js';
import {
  ILedgerRepository,
  PaginatedLedgerEntries,
} from '../../../../domain/ledger/ledger.repository.interface.js';
import { Money } from '../../../../domain/shared/money.js';

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

  async findEntriesByWalletId(
    walletId: string,
    cursor?: string,
    limit: number = 50,
  ): Promise<PaginatedLedgerEntries> {
    const where: any = { walletId };

    // Decodifica o cursor opaco (base64 contendo 'ISOString|id')
    if (cursor) {
      try {
        const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
        const [createdAtStr, id] = decoded.split('|');
        const createdAt = new Date(createdAtStr);

        where.$or = [
          { createdAt: { $lt: createdAt } },
          { createdAt, id: { $lt: id } },
        ];
      } catch {
        // Se o cursor for inválido, apenas ignora e começa do topo
      }
    }

    const entities = await this.em.find(
      LedgerEntryOrmEntity,
      where,
      {
        orderBy: { createdAt: QueryOrder.DESC, id: QueryOrder.DESC },
        limit: limit + 1, // Busca 1 a mais para saber se tem próxima página
      },
    );

    const hasNext = entities.length > limit;
    const itemsToReturn = hasNext ? entities.slice(0, limit) : entities;

    let nextCursor: string | undefined = undefined;
    if (hasNext && itemsToReturn.length > 0) {
      const lastItem = itemsToReturn[itemsToReturn.length - 1];
      const rawCursor = `${lastItem.createdAt.toISOString()}|${lastItem.id}`;
      nextCursor = Buffer.from(rawCursor, 'utf-8').toString('base64');
    }

    const items = itemsToReturn.map(e => this.toDomain(e));

    return {
      items,
      nextCursor,
    };
  }

  async findAllByWalletId(walletId: string): Promise<WalletLedgerEntry[]> {
    const entities = await this.em.find(
      LedgerEntryOrmEntity,
      { walletId },
      { orderBy: { createdAt: QueryOrder.ASC, id: QueryOrder.ASC } },
    );

    return entities.map(e => this.toDomain(e));
  }

  private toDomain(entity: LedgerEntryOrmEntity): WalletLedgerEntry {
    return WalletLedgerEntry.rehydrate({
      id: entity.id,
      walletId: entity.walletId,
      transactionId: entity.transactionId,
      direction: entity.direction,
      money: Money.from({ amount: entity.moneyAmount, currency: entity.currency }),
      balanceBefore: Money.from({ amount: entity.balanceBeforeAmount, currency: entity.currency }),
      balanceAfter: Money.from({ amount: entity.balanceAfterAmount, currency: entity.currency }),
      createdAt: entity.createdAt,
    });
  }
}
