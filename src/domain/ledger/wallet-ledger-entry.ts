import { Money } from "../shared/money.js";

export enum LedgerDirection {
  Debit  = "DEBIT",
  Credit = "CREDIT",
}

export class UnbalancedLedgerEntryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnbalancedLedgerEntryError";
  }
}

export interface CreateLedgerEntryProps {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
}

export interface LedgerEntryState {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
  createdAt: Date;
}

/**
 * WalletLedgerEntry (Imutável)
 *
 * Registra cada lançamento contábil atrelado a uma movimentação de saldo.
 * - Sem campos mutáveis e sem métodos de transição.
 * - Toda entrada deve ser balanceada (balanceBefore ± money === balanceAfter).
 */
export class WalletLedgerEntry {
  private constructor(
    public readonly id: string,
    public readonly walletId: string,
    public readonly transactionId: string,
    public readonly direction: LedgerDirection,
    public readonly money: Money,
    public readonly balanceBefore: Money,
    public readonly balanceAfter: Money,
    public readonly createdAt: Date,
  ) {}

  /**
   * Factory para criar um novo lançamento contábil.
   * Valida rigorosamente a consistência aritmética do lançamento.
   */
  static create(props: CreateLedgerEntryProps): WalletLedgerEntry {
    if (props.money.isNegative() || props.money.isZero()) {
      throw new UnbalancedLedgerEntryError("Ledger entry money amount must be strictly positive");
    }

    const entry = new WalletLedgerEntry(
      props.id,
      props.walletId,
      props.transactionId,
      props.direction,
      props.money,
      props.balanceBefore,
      props.balanceAfter,
      new Date(),
    );

    if (!entry.isBalanced()) {
      throw new UnbalancedLedgerEntryError(
        `Ledger entry is unbalanced: balanceBefore (${props.balanceBefore.toString()}) ` +
        `${props.direction === LedgerDirection.Credit ? '+' : '-'} money (${props.money.toString()}) ` +
        `does not match balanceAfter (${props.balanceAfter.toString()})`
      );
    }

    return entry;
  }

  /**
   * Reconstrução a partir do banco de dados (não revalida regras).
   */
  static rehydrate(state: LedgerEntryState): WalletLedgerEntry {
    return new WalletLedgerEntry(
      state.id,
      state.walletId,
      state.transactionId,
      state.direction,
      state.money,
      state.balanceBefore,
      state.balanceAfter,
      state.createdAt,
    );
  }

  /**
   * Verifica se o lançamento está matematicamente correto:
   * balanceBefore ± money === balanceAfter
   */
  isBalanced(): boolean {
    const expected = this.direction === LedgerDirection.Credit
      ? this.balanceBefore.add(this.money)
      : this.balanceBefore.subtract(this.money);

    return expected.equals(this.balanceAfter);
  }
}