import { Entity, PrimaryKey, Property, Index, Check } from '@mikro-orm/core';
import { LedgerDirection } from '../../../../domain/ledger/wallet-ledger-entry.js';

@Entity({ tableName: 'wallet_ledger_entries' })
@Index({ properties: ['walletId', 'createdAt'], name: 'idx_ledger_wallet_created' })
@Check({ expression: 'money_amount > 0', name: 'chk_ledger_money_positive' })
export class LedgerEntryOrmEntity {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ type: 'uuid' })
  walletId!: string;

  @Property({ type: 'uuid' })
  transactionId!: string;

  @Property({ type: 'varchar', length: 10 })
  direction!: LedgerDirection;

  @Property({ type: 'decimal', precision: 18, scale: 2 })
  moneyAmount!: string;

  @Property({ type: 'varchar', length: 3 })
  currency!: string;

  @Property({ type: 'decimal', precision: 18, scale: 2 })
  balanceBeforeAmount!: string;

  @Property({ type: 'decimal', precision: 18, scale: 2 })
  balanceAfterAmount!: string;

  @Property({ type: 'timestamptz' })
  createdAt: Date = new Date();
}

