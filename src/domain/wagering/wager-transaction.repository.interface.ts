import { WagerTransaction } from './wager-transaction.js';

export interface IWagerTransactionRepository {
  findById(id: string): Promise<WagerTransaction | null>;
  findByIdempotencyKey(idempotencyKey: string): Promise<WagerTransaction | null>;
  findByProviderAndExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null>;
  save(transaction: WagerTransaction): Promise<void>;
}

export const WAGER_TRANSACTION_REPOSITORY_TOKEN = Symbol('IWagerTransactionRepository');

