import { Money } from '../shared/money.js';

// ─── Errors ───────────────────────────────────────────────────

export class InsufficientFundsError extends Error {
  constructor(walletId: string, requested: Money, available: Money) {
    super(
      `Insufficient funds in wallet ${walletId}: ` +
      `requested ${requested.toString()} ${requested.currency}, ` +
      `available ${available.toString()} ${available.currency}`,
    );
    this.name = 'InsufficientFundsError';
  }
}

export class WalletCurrencyMismatchError extends Error {
  constructor(walletCurrency: string, operationCurrency: string) {
    super(
      `Wallet currency is ${walletCurrency}, ` +
      `but operation currency is ${operationCurrency}`,
    );
    this.name = 'WalletCurrencyMismatchError';
  }
}

// ─── Tipos auxiliares ─────────────────────────────────────────

/** Dados para abrir uma nova Wallet. */
export interface OpenWalletProps {
  id: string;
  playerId: string;
  initialBalance: Money;
}

/**
 * Snapshot completo de uma Wallet já persistida.
 * Usado exclusivamente pelo `rehydrate` para reconstruir
 * o objeto a partir do banco de dados sem revalidar regras.
 */
export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balanceAmount: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Resultado retornado pelos métodos `debit` e `credit`.
 * Carrega o saldo antes e depois da operação, para que
 * a camada de aplicação possa criar o LedgerEntry correspondente.
 */
export interface BalanceChange {
  balanceBefore: Money;
  balanceAfter: Money;
}

// ─── Aggregate Root ───────────────────────────────────────────

export class Wallet {
  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  // ─── Factories ────────────────────────────────────────────

  /**
   * Cria uma nova wallet.
   *
   * Invariantes aplicadas aqui:
   * - O saldo inicial não pode ser negativo.
   * - A version começa em 1 (README: "version inicia em 1 após a criação").
   *
   * Se o saldo inicial for maior que zero, a camada de aplicação
   * (use case) é responsável por gerar a transação OPENING e o
   * lançamento CREDIT correspondente na mesma transação SQL.
   */
  static open(props: OpenWalletProps): Wallet {
    const { id, playerId, initialBalance } = props;

    if (initialBalance.isNegative()) {
      throw new Error('Initial balance cannot be negative');
    }

    const now = new Date();

    return new Wallet(
      id,
      playerId,
      initialBalance.currency,
      initialBalance,
      1, // version inicia em 1 após a criação (conforme README 6.2)
      now,
      now,
    );
  }

  /**
   * Reconstrução a partir da persistência.
   * NÃO revalida regras de transição — apenas reconstrói
   * o estado que já foi validado e salvo no banco.
   */
  static rehydrate(state: WalletState): Wallet {
    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      Money.from({ amount: state.balanceAmount, currency: state.currency }),
      state.version,
      state.createdAt,
      state.updatedAt,
    );
  }

  // ─── Getters ──────────────────────────────────────────────

  get balance(): Money {
    return this._balance;
  }

  get version(): number {
    return this._version;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  // ─── Operações de movimentação ────────────────────────────

  /**
   * Debita um valor da wallet (usado em BET, ROLLBACK de WIN, etc.)
   *
   * Invariantes:
   * 1. Moeda da operação deve ser igual à moeda da wallet.
   * 2. Saldo nunca pode ficar negativo.
   * 3. A version incrementa somente quando o saldo muda.
   * 4. Retorna o saldo antes e depois para o LedgerEntry.
   */
  debit(amount: Money): BalanceChange {
    this.assertSameCurrency(amount);

    if (this._balance.isLessThan(amount)) {
      throw new InsufficientFundsError(this.id, amount, this._balance);
    }

    const balanceBefore = this._balance;
    this._balance = this._balance.subtract(amount);
    this._version++;
    this._updatedAt = new Date();

    return {
      balanceBefore,
      balanceAfter: this._balance,
    };
  }

  /**
   * Credita um valor na wallet (usado em WIN, REFUND, ROLLBACK de BET, OPENING, etc.)
   *
   * Invariantes:
   * 1. Moeda da operação deve ser igual à moeda da wallet.
   * 2. O valor creditado deve ser positivo.
   * 3. A version incrementa somente quando o saldo muda.
   * 4. Retorna o saldo antes e depois para o LedgerEntry.
   */
  credit(amount: Money): BalanceChange {
    this.assertSameCurrency(amount);

    if (amount.isNegative() || amount.isZero()) {
      throw new Error('Credit amount must be positive');
    }

    const balanceBefore = this._balance;
    this._balance = this._balance.add(amount);
    this._version++;
    this._updatedAt = new Date();

    return {
      balanceBefore,
      balanceAfter: this._balance,
    };
  }

  // ─── Validação interna ────────────────────────────────────

  /**
   * Garante que a moeda da operação seja a mesma da wallet.
   * Exemplo: uma wallet em BRL não aceita uma aposta em USD.
   */
  private assertSameCurrency(money: Money): void {
    if (this.currency !== money.currency) {
      throw new WalletCurrencyMismatchError(this.currency, money.currency);
    }
  }
}
