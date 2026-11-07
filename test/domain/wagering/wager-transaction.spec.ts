import { describe, it, expect } from "bun:test";
import { Money } from "../../../src/domain/shared/money.js";
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
  LedgerDirection,
  FailureCode,
  InvalidTransactionStateError,
} from "../../../src/domain/wagering/wager-transaction.js";

describe("WagerTransaction", () => {
  const money100 = Money.from({ amount: "100.00", currency: "BRL" });

  function createSampleProps(kind: WagerTransactionKind, refId?: string) {
    return {
      id: "tx-001",
      providerId: "provider-a",
      externalTransactionId: "ext-001",
      idempotencyKey: "provider-a:ext-001",
      payloadHash: "hash-123",
      walletId: "wallet-1",
      playerId: "player-1",
      roundId: "round-1",
      gameId: "fortune-ox",
      kind,
      money: money100,
      referenceExternalTransactionId: refId,
    };
  }

  describe("create", () => {
    it("deve criar uma transação no estado PENDING", () => {
      const tx = WagerTransaction.create(createSampleProps(WagerTransactionKind.Bet));

      expect(tx.status).toBe(WagerTransactionStatus.Pending);
      expect(tx.failureCode).toBeUndefined();
      expect(tx.processedAt).toBeUndefined();
      expect(tx.isTerminal()).toBe(false);
    });

    it("deve proibir criação externa de OPENING", () => {
      expect(() => {
        WagerTransaction.create(createSampleProps(WagerTransactionKind.Opening));
      }).toThrow("OPENING transactions cannot be created externally");
    });

    it("deve exigir referenceExternalTransactionId para REFUND", () => {
      expect(() => {
        WagerTransaction.create(createSampleProps(WagerTransactionKind.Refund));
      }).toThrow("REFUND requires a referenceExternalTransactionId");
    });

    it("deve exigir referenceExternalTransactionId para ROLLBACK", () => {
      expect(() => {
        WagerTransaction.create(createSampleProps(WagerTransactionKind.Rollback));
      }).toThrow("ROLLBACK requires a referenceExternalTransactionId");
    });
  });

  describe("transições e imutabilidade de estado terminal", () => {
    it("deve transicionar com sucesso de PENDING para PROCESSED", () => {
      const tx = WagerTransaction.create(createSampleProps(WagerTransactionKind.Bet));
      const now = new Date();

      tx.markProcessed(undefined, now);
      expect(tx.status).toBe(WagerTransactionStatus.Processed);
      expect(tx.isTerminal()).toBe(true);
    });

    it("deve transicionar para PENDING_REFERENCE e depois para PROCESSED", () => {
      const tx = WagerTransaction.create(
        createSampleProps(WagerTransactionKind.Refund, "ext-bet-001")
      );

      tx.markPendingReference();
      expect(tx.status).toBe(WagerTransactionStatus.PendingReference);
      expect(tx.isTerminal()).toBe(false);

      tx.markProcessed("int-bet-001", new Date());
      expect(tx.status).toBe(WagerTransactionStatus.Processed);
      expect(tx.isTerminal()).toBe(true);
    });

    it("não deve permitir transicionar uma transação já PROCESSED", () => {
      const tx = WagerTransaction.create(createSampleProps(WagerTransactionKind.Bet));
      tx.markProcessed(undefined, new Date());

      expect(() => {
        tx.reject(FailureCode.InsufficientFunds);
      }).toThrow(InvalidTransactionStateError);
    });

    it("não deve permitir transicionar uma transação já REJECTED", () => {
      const tx = WagerTransaction.create(createSampleProps(WagerTransactionKind.Bet));
      tx.reject(FailureCode.InsufficientFunds);

      expect(() => {
        tx.markProcessed(undefined, new Date());
      }).toThrow(InvalidTransactionStateError);
    });
  });

  describe("direção no ledger (ledgerDirectionFor)", () => {
    it("BET deve produzir DEBIT", () => {
      const tx = WagerTransaction.create(createSampleProps(WagerTransactionKind.Bet));
      expect(tx.ledgerDirectionFor()).toBe(LedgerDirection.Debit);
    });

    it("WIN e REFUND devem produzir CREDIT", () => {
      const winTx = WagerTransaction.create(createSampleProps(WagerTransactionKind.Win));
      const refundTx = WagerTransaction.create(
        createSampleProps(WagerTransactionKind.Refund, "ext-001")
      );

      expect(winTx.ledgerDirectionFor()).toBe(LedgerDirection.Credit);
      expect(refundTx.ledgerDirectionFor()).toBe(LedgerDirection.Credit);
    });

    it("ROLLBACK deve inverter a direção da transação referenciada", () => {
      const betTx = WagerTransaction.create(createSampleProps(WagerTransactionKind.Bet));
      const rollbackBet = WagerTransaction.create(
        createSampleProps(WagerTransactionKind.Rollback, "ext-001")
      );
      // Rollback de BET (débito) -> gera CREDIT
      expect(rollbackBet.ledgerDirectionFor(betTx)).toBe(LedgerDirection.Credit);

      const winTx = WagerTransaction.create(createSampleProps(WagerTransactionKind.Win));
      const rollbackWin = WagerTransaction.create(
        createSampleProps(WagerTransactionKind.Rollback, "ext-002")
      );
      // Rollback de WIN (crédito) -> gera DEBIT
      expect(rollbackWin.ledgerDirectionFor(winTx)).toBe(LedgerDirection.Debit);
    });

    it("LOSS não deve gerar lançamento no ledger", () => {
      const lossTx = WagerTransaction.create(createSampleProps(WagerTransactionKind.Loss));
      expect(() => lossTx.ledgerDirectionFor()).toThrow("LOSS does not produce a ledger entry");
    });
  });
});

