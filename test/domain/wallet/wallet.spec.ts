import { describe, it, expect } from 'bun:test';
import { Money } from '../../../src/domain/shared/money.js';
import {
  Wallet,
  InsufficientFundsError,
  WalletCurrencyMismatchError,
} from '../../../src/domain/wallet/wallet.js';

describe('Wallet', () => {
  // ─── Helper ─────────────────────────────────────────────────
  function openWallet(amount = '1000.00', currency = 'BRL'): Wallet {
    return Wallet.open({
      id: 'wallet-001',
      playerId: 'player-001',
      initialBalance: Money.from({ amount, currency }),
    });
  }

  // ─── open (factory) ─────────────────────────────────────────

  describe('open', () => {
    it('deve criar uma wallet com saldo inicial e version = 1', () => {
      const wallet = openWallet('500.00');

      expect(wallet.id).toBe('wallet-001');
      expect(wallet.playerId).toBe('player-001');
      expect(wallet.currency).toBe('BRL');
      expect(wallet.balance.toString()).toBe('500.00');
      expect(wallet.version).toBe(1);
    });

    it('deve criar wallet com saldo zero', () => {
      const wallet = openWallet('0.00');

      expect(wallet.balance.toString()).toBe('0.00');
      expect(wallet.version).toBe(1);
    });

    it('deve rejeitar saldo inicial negativo', () => {
      expect(() =>
        Wallet.open({
          id: 'w1',
          playerId: 'p1',
          initialBalance: Money.from({ amount: '-10.00', currency: 'BRL' }),
        }),
      ).toThrow('Initial balance cannot be negative');
    });
  });

  // ─── rehydrate ──────────────────────────────────────────────

  describe('rehydrate', () => {
    it('deve reconstruir a wallet sem revalidar regras', () => {
      const wallet = Wallet.rehydrate({
        id: 'wallet-002',
        playerId: 'player-002',
        currency: 'BRL',
        balanceAmount: '750.50',
        version: 5,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-06-15'),
      });

      expect(wallet.id).toBe('wallet-002');
      expect(wallet.balance.toString()).toBe('750.50');
      expect(wallet.version).toBe(5);
    });
  });

  // ─── debit ──────────────────────────────────────────────────

  describe('debit', () => {
    it('deve debitar e retornar saldo antes/depois', () => {
      const wallet = openWallet('100.00');

      const change = wallet.debit(Money.from({ amount: '25.00', currency: 'BRL' }));

      expect(change.balanceBefore.toString()).toBe('100.00');
      expect(change.balanceAfter.toString()).toBe('75.00');
      expect(wallet.balance.toString()).toBe('75.00');
    });

    it('deve incrementar a version a cada débito', () => {
      const wallet = openWallet('200.00');

      expect(wallet.version).toBe(1);

      wallet.debit(Money.from({ amount: '50.00', currency: 'BRL' }));
      expect(wallet.version).toBe(2);

      wallet.debit(Money.from({ amount: '50.00', currency: 'BRL' }));
      expect(wallet.version).toBe(3);
    });

    it('deve rejeitar débito se saldo insuficiente', () => {
      const wallet = openWallet('100.00');

      expect(() =>
        wallet.debit(Money.from({ amount: '150.00', currency: 'BRL' })),
      ).toThrow(InsufficientFundsError);
    });

    it('deve rejeitar débito em moeda diferente da wallet', () => {
      const wallet = openWallet('100.00', 'BRL');

      expect(() =>
        wallet.debit(Money.from({ amount: '10.00', currency: 'USD' })),
      ).toThrow(WalletCurrencyMismatchError);
    });

    it('cenário obrigatório: saldo 100, duas apostas de 80 em sequência', () => {
      const wallet = openWallet('100.00');

      // Primeira aposta de 80 → deve funcionar
      wallet.debit(Money.from({ amount: '80.00', currency: 'BRL' }));
      expect(wallet.balance.toString()).toBe('20.00');

      // Segunda aposta de 80 → deve ser rejeitada (saldo insuficiente)
      expect(() =>
        wallet.debit(Money.from({ amount: '80.00', currency: 'BRL' })),
      ).toThrow(InsufficientFundsError);

      // Saldo final deve ser 20.00
      expect(wallet.balance.toString()).toBe('20.00');
    });
  });

  // ─── credit ─────────────────────────────────────────────────

  describe('credit', () => {
    it('deve creditar e retornar saldo antes/depois', () => {
      const wallet = openWallet('100.00');

      const change = wallet.credit(Money.from({ amount: '50.00', currency: 'BRL' }));

      expect(change.balanceBefore.toString()).toBe('100.00');
      expect(change.balanceAfter.toString()).toBe('150.00');
      expect(wallet.balance.toString()).toBe('150.00');
    });

    it('deve incrementar a version a cada crédito', () => {
      const wallet = openWallet('100.00');

      wallet.credit(Money.from({ amount: '10.00', currency: 'BRL' }));
      expect(wallet.version).toBe(2);
    });

    it('deve rejeitar crédito em moeda diferente', () => {
      const wallet = openWallet('100.00', 'BRL');

      expect(() =>
        wallet.credit(Money.from({ amount: '10.00', currency: 'USD' })),
      ).toThrow(WalletCurrencyMismatchError);
    });

    it('deve rejeitar crédito com valor zero', () => {
      const wallet = openWallet('100.00');

      expect(() =>
        wallet.credit(Money.from({ amount: '0.00', currency: 'BRL' })),
      ).toThrow('Credit amount must be positive');
    });
  });

  // ─── fluxo completo: BET → WIN ─────────────────────────────

  describe('fluxo BET → WIN', () => {
    it('deve debitar a aposta e depois creditar o prêmio', () => {
      const wallet = openWallet('1000.00');

      // Jogador aposta 25.00
      const betChange = wallet.debit(Money.from({ amount: '25.00', currency: 'BRL' }));
      expect(betChange.balanceBefore.toString()).toBe('1000.00');
      expect(betChange.balanceAfter.toString()).toBe('975.00');

      // Jogador ganha 100.00
      const winChange = wallet.credit(Money.from({ amount: '100.00', currency: 'BRL' }));
      expect(winChange.balanceBefore.toString()).toBe('975.00');
      expect(winChange.balanceAfter.toString()).toBe('1075.00');

      // State final
      expect(wallet.balance.toString()).toBe('1075.00');
      expect(wallet.version).toBe(3); // 1 (open) + 1 (debit) + 1 (credit)
    });
  });
});
