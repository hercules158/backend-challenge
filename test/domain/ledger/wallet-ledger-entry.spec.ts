import { describe, it, expect } from "bun:test";
import { Money } from "../../../src/domain/shared/money.js";
import {
  WalletLedgerEntry,
  LedgerDirection,
  UnbalancedLedgerEntryError,
} from "../../../src/domain/ledger/wallet-ledger-entry.js";

describe("WalletLedgerEntry", () => {
  const money25 = Money.from({ amount: "25.00", currency: "BRL" });
  const money100 = Money.from({ amount: "100.00", currency: "BRL" });
  const money75 = Money.from({ amount: "75.00", currency: "BRL" });
  const money125 = Money.from({ amount: "125.00", currency: "BRL" });

  describe("create com DEBIT", () => {
    it("deve criar lançamento de débito quando a matemática fecha (100 - 25 = 75)", () => {
      const entry = WalletLedgerEntry.create({
        id: "led-001",
        walletId: "wal-001",
        transactionId: "tx-001",
        direction: LedgerDirection.Debit,
        money: money25,
        balanceBefore: money100,
        balanceAfter: money75,
      });

      expect(entry.id).toBe("led-001");
      expect(entry.direction).toBe(LedgerDirection.Debit);
      expect(entry.isBalanced()).toBe(true);
    });

    it("deve lançar UnbalancedLedgerEntryError se 100 - 25 != 80", () => {
      const moneyWrong = Money.from({ amount: "80.00", currency: "BRL" });

      expect(() => {
        WalletLedgerEntry.create({
          id: "led-001",
          walletId: "wal-001",
          transactionId: "tx-001",
          direction: LedgerDirection.Debit,
          money: money25,
          balanceBefore: money100,
          balanceAfter: moneyWrong, // conta errada propositalmente
        });
      }).toThrow(UnbalancedLedgerEntryError);
    });
  });

  describe("create com CREDIT", () => {
    it("deve criar lançamento de crédito quando a matemática fecha (100 + 25 = 125)", () => {
      const entry = WalletLedgerEntry.create({
        id: "led-002",
        walletId: "wal-001",
        transactionId: "tx-002",
        direction: LedgerDirection.Credit,
        money: money25,
        balanceBefore: money100,
        balanceAfter: money125,
      });

      expect(entry.id).toBe("led-002");
      expect(entry.direction).toBe(LedgerDirection.Credit);
      expect(entry.isBalanced()).toBe(true);
    });

    it("deve rejeitar valor monetário zero ou negativo", () => {
      const zeroMoney = Money.zero("BRL");

      expect(() => {
        WalletLedgerEntry.create({
          id: "led-003",
          walletId: "wal-001",
          transactionId: "tx-003",
          direction: LedgerDirection.Credit,
          money: zeroMoney,
          balanceBefore: money100,
          balanceAfter: money100,
        });
      }).toThrow(UnbalancedLedgerEntryError);
    });
  });

  describe("rehydrate", () => {
    it("deve reconstruir o registro do banco de dados", () => {
      const now = new Date("2026-01-01");
      const entry = WalletLedgerEntry.rehydrate({
        id: "led-rehydrate",
        walletId: "wal-001",
        transactionId: "tx-001",
        direction: LedgerDirection.Debit,
        money: money25,
        balanceBefore: money100,
        balanceAfter: money75,
        createdAt: now,
      });

      expect(entry.id).toBe("led-rehydrate");
      expect(entry.createdAt).toEqual(now);
    });
  });
});

