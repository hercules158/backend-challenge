import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { IWalletRepository } from '../../../../domain/wallet/wallet.repository.interface.js';
import { Wallet } from '../../../../domain/wallet/wallet.js';
import { WalletOrmEntity } from '../entities/wallet.orm-entity.js';

@Injectable()
export class MikroOrmWalletRepository implements IWalletRepository {
  constructor(private readonly em: EntityManager) {}

  async findById(id: string): Promise<Wallet | null> {
    const entity = await this.em.findOne(WalletOrmEntity, { id });
    if (!entity) return null;

    return Wallet.rehydrate({
      id: entity.id,
      playerId: entity.playerId,
      currency: entity.currency,
      balanceAmount: entity.balanceAmount,
      version: entity.version,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    });
  }

  async findByPlayerIdAndCurrency(playerId: string, currency: string): Promise<Wallet | null> {
    const entity = await this.em.findOne(WalletOrmEntity, { playerId, currency });
    if (!entity) return null;

    return Wallet.rehydrate({
      id: entity.id,
      playerId: entity.playerId,
      currency: entity.currency,
      balanceAmount: entity.balanceAmount,
      version: entity.version,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    });
  }

  async save(wallet: Wallet): Promise<void> {
    const existing = await this.em.findOne(WalletOrmEntity, { id: wallet.id });

    if (existing) {
      existing.balanceAmount = wallet.balance.toString();
      existing.version = wallet.version;
      existing.updatedAt = wallet.updatedAt;
    } else {
      const entity = this.em.create(WalletOrmEntity, {
        id: wallet.id,
        playerId: wallet.playerId,
        currency: wallet.currency,
        balanceAmount: wallet.balance.toString(),
        version: wallet.version,
        createdAt: wallet.createdAt,
        updatedAt: wallet.updatedAt,
      });
      this.em.persist(entity);
    }

    await this.em.flush();
  }
}

