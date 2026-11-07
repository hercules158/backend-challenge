import { Wallet } from '../../domain/wallet/wallet.js';
import { Money, MoneyProps } from '../../domain/shared/money.js';
import { WalletLedgerEntry, LedgerDirection } from '../../domain/ledger/wallet-ledger-entry.js';
import { randomUUID } from 'node:crypto';
import { ILedgerRepository } from '../../domain/ledger/ledger.repository.interface.js';

// ─── DTOs do Caso de Uso ──────────────────────────────────────

export interface CreateWalletInput {
  playerId: string;
  initialBalance: MoneyProps;
}

export interface CreateWalletOutput {
  id: string;
  playerId: string;
  balance: MoneyProps;
  version: number;
}

export class WalletAlreadyExistsError extends Error {
  constructor(
    public readonly playerId: string,
    public readonly currency: string,
    public readonly existingWalletId: string, // <-- adicione aqui
  ) {
    super(`Wallet already exists for player ${playerId} with currency ${currency}`);
    this.name = 'WalletAlreadyExistsError';
  }
}

// ─── Interfaces das Portas necessárias ────────────────────────

export interface IWalletRepository {
  findById(id: string): Promise<Wallet | null>;
  findByPlayerIdAndCurrency(playerId: string, currency: string): Promise<Wallet | null>;
  save(wallet: Wallet): Promise<void>;
}

// ─── O SERVICE / CASO DE USO ──────────────────────────────────

export class CreateWalletUseCase {
  constructor(
    private readonly walletRepository: IWalletRepository,
    private readonly ledgerRepository?: ILedgerRepository,
  ) {}

  async execute(input: CreateWalletInput): Promise<CreateWalletOutput> {
    const initialMoney = Money.from(input.initialBalance);

    // 1. Invariante: No máximo uma wallet por playerId + currency
    const existing = await this.walletRepository.findByPlayerIdAndCurrency(
      input.playerId,
      initialMoney.currency,
    );

    if (existing) {
        throw new WalletAlreadyExistsError(input.playerId, initialMoney.currency, existing.id);
    }

    // 2. Cria a nova Wallet no Domínio
    const walletId = randomUUID();
    const wallet = Wallet.open({
      id: walletId,
      playerId: input.playerId,
      initialBalance: initialMoney,
    });

    // 3. Persiste a Wallet
    await this.walletRepository.save(wallet);

    // 4. Se o saldo inicial for maior que zero, gera o lançamento contábil de OPENING no ledger
    if (initialMoney.isPositive() && this.ledgerRepository) {
      const openingTxId = randomUUID();
      const ledgerEntry = WalletLedgerEntry.create({
        id: randomUUID(),
        walletId: wallet.id,
        transactionId: openingTxId,
        direction: LedgerDirection.Credit,
        money: initialMoney,
        balanceBefore: Money.zero(initialMoney.currency),
        balanceAfter: initialMoney,
      });

      await this.ledgerRepository.save(ledgerEntry);
    }

    // 5. Retorna o DTO de saída esperado pelo contrato da API
    return {
      id: wallet.id,
      playerId: wallet.playerId,
      balance: wallet.balance.toJSON(),
      version: wallet.version,
    };
  }
}

