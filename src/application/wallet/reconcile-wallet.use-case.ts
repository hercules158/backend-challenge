import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import {
  type IWalletRepository,
  WALLET_REPOSITORY_TOKEN,
} from '../../domain/wallet/wallet.repository.interface.js';
import {
  type ILedgerRepository,
  LEDGER_REPOSITORY_TOKEN,
} from '../../domain/ledger/ledger.repository.interface.js';
import { Money, MoneyProps } from '../../domain/shared/money.js';
import { LedgerDirection } from '../../domain/ledger/wallet-ledger-entry.js';

export interface ReconcileWalletOutput {
  walletId: string;
  storedBalance: MoneyProps;
  calculatedBalance: MoneyProps;
  difference: MoneyProps;
  consistent: boolean;
  checkedEntries: number;
}

@Injectable()
export class ReconcileWalletUseCase {
  constructor(
    @Inject(WALLET_REPOSITORY_TOKEN)
    private readonly walletRepo: IWalletRepository,
    @Inject(LEDGER_REPOSITORY_TOKEN)
    private readonly ledgerRepo: ILedgerRepository,
  ) {}

  async execute(walletId: string): Promise<ReconcileWalletOutput> {
    const wallet = await this.walletRepo.findById(walletId);
    if (!wallet) {
      throw new NotFoundException(`Wallet ${walletId} not found`);
    }

    // Busca todos os lançamentos contábeis em ordem cronológica
    const entries = await this.ledgerRepo.findAllByWalletId(walletId);

    // Recalcula o saldo a partir do zero
    let calculated = Money.zero(wallet.currency);

    for (const entry of entries) {
      if (entry.direction === LedgerDirection.Credit) {
        calculated = calculated.add(entry.money);
      } else {
        calculated = calculated.subtract(entry.money);
      }
    }

    const storedBalance = wallet.balance;
    const difference = storedBalance.subtract(calculated);
    const consistent = difference.isZero();

    return {
      walletId: wallet.id,
      storedBalance: storedBalance.toJSON(),
      calculatedBalance: calculated.toJSON(),
      difference: difference.toJSON(),
      consistent,
      checkedEntries: entries.length,
    };
  }
}

