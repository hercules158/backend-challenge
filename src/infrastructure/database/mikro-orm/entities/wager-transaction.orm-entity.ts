import { Entity, PrimaryKey, Property, Unique, Index } from '@mikro-orm/core';
import {
  WagerTransactionKind,
  WagerTransactionStatus,
  FailureCode,
} from '../../../../domain/wagering/wager-transaction.js';

@Entity({ tableName: 'wager_transactions' })
@Unique({ properties: ['idempotencyKey'], name: 'uq_wager_tx_idempotency_key' })
@Unique({ properties: ['providerId', 'externalTransactionId'], name: 'uq_wager_tx_provider_external' })
@Index({ properties: ['walletId', 'createdAt'], name: 'idx_wager_tx_wallet_created' })
export class WagerTransactionOrmEntity {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ type: 'varchar', length: 100 })
  providerId!: string;

  @Property({ type: 'varchar', length: 255 })
  externalTransactionId!: string;

  @Property({ type: 'varchar', length: 350 })
  idempotencyKey!: string;

  @Property({ type: 'varchar', length: 64 })
  payloadHash!: string;

  @Property({ type: 'uuid' })
  walletId!: string;

  @Property({ type: 'uuid' })
  playerId!: string;

  @Property({ type: 'varchar', length: 100 })
  roundId!: string;

  @Property({ type: 'varchar', length: 100 })
  gameId!: string;

  @Property({ type: 'varchar', length: 20 })
  kind!: WagerTransactionKind;

  @Property({ type: 'decimal', precision: 18, scale: 2 })
  moneyAmount!: string;

  @Property({ type: 'varchar', length: 3 })
  currency!: string;

  @Property({ type: 'varchar', length: 255, nullable: true })
  referenceExternalTransactionId?: string;

  @Property({ type: 'uuid', nullable: true })
  referenceTransactionId?: string;

  @Property({ type: 'varchar', length: 30 })
  status!: WagerTransactionStatus;

  @Property({ type: 'varchar', length: 50, nullable: true })
  failureCode?: FailureCode;

  @Property({ type: 'timestamptz' })
  createdAt: Date = new Date();

  @Property({ type: 'timestamptz', nullable: true })
  processedAt?: Date;
}

