import { Entity, PrimaryKey, Property, Unique, Check } from '@mikro-orm/core';

@Entity({ tableName: 'wallets' })
@Unique({ properties: ['playerId', 'currency'], name: 'uq_wallets_player_currency' })
@Check({ expression: 'balance_amount >= 0', name: 'chk_wallets_balance_non_negative' })
export class WalletOrmEntity {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ type: 'uuid' })
  playerId!: string;

  @Property({ type: 'varchar', length: 3 })
  currency!: string;

  @Property({ type: 'decimal', precision: 18, scale: 2 })
  balanceAmount!: string;

  @Property({ type: 'integer' })
  version!: number;

  @Property({ type: 'timestamptz' })
  createdAt: Date = new Date();

  @Property({ type: 'timestamptz', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}

