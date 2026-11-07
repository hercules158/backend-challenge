import { describe, it, expect, beforeEach } from 'bun:test';
import {
  CreateWalletUseCase,
  WalletAlreadyExistsError,
  IWalletRepository,
  ILedgerRepository,
} from '../../../src/application/wallet/create-wallet.use-case.js';
import { Wallet } from '../../../src/domain/wallet/wallet.js';
import { WalletLedgerEntry } from '../../../src/domain/ledger/wallet-ledger-entry.js';

// Repositório Fake em memória para testes
class InMemoryWalletRepository implements IWalletRepository {
  public items: Map<string, Wallet> = new Map();

  async findById(id: string): Promise<Wallet | null> {
    return this.items.get(id) || null;
  }

  async findByPlayerIdAndCurrency(playerId: string, currency: string): Promise<Wallet | null> {
    for (const wallet of this.items.values()) {
      if (wallet.playerId === playerId && wallet.currency === currency) {
        return wallet;
      }
    }
    return null;
  }

  async save(wallet: Wallet): Promise<void> {
    this.items.set(wallet.id, wallet);
  }
}

class InMemoryLedgerRepository implements ILedgerRepository {
  public items: WalletLedgerEntry[] = [];

  async save(entry: WalletLedgerEntry): Promise<void> {
    this.items.push(entry);
  }
}

describe('CreateWalletUseCase (Service)', () => {
  let walletRepo: InMemoryWalletRepository;
  let ledgerRepo: InMemoryLedgerRepository;
  let useCase: CreateWalletUseCase;

  beforeEach(() => {
    walletRepo = new InMemoryWalletRepository();
    ledgerRepo = new InMemoryLedgerRepository();
    useCase = new CreateWalletUseCase(walletRepo, ledgerRepo);
  });

  it('deve criar uma carteira com saldo inicial e registrar no ledger', async () => {
    const output = await useCase.execute({
      playerId: 'player-01',
      initialBalance: { amount: '1000.00', currency: 'BRL' },
    });

    expect(output.playerId).toBe('player-01');
    expect(output.balance.amount).toBe('1000.00');
    expect(output.balance.currency).toBe('BRL');
    expect(output.version).toBe(1);

    // Verifica se salvou no repositório de carteiras
    const savedWallet = await walletRepo.findById(output.id);
    expect(savedWallet).toBeDefined();

    // Verifica se gerou o lançamento no Ledger para o saldo inicial
    expect(ledgerRepo.items.length).toBe(1);
    expect(ledgerRepo.items[0].money.toString()).toBe('1000.00');
  });

  it('deve proibir criação de carteira duplicada para o mesmo jogador e moeda', async () => {
    await useCase.execute({
      playerId: 'player-01',
      initialBalance: { amount: '500.00', currency: 'BRL' },
    });

    // Tentar criar de novo com o mesmo player e mesma moeda deve falhar (409 Conflict)
    expect(
      useCase.execute({
        playerId: 'player-01',
        initialBalance: { amount: '200.00', currency: 'BRL' },
      }),
    ).rejects.toThrow(WalletAlreadyExistsError);
  });
});

