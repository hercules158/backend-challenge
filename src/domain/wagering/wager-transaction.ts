import { Money } from "../shared/money.js";

// ─── Enums de Domínio ──────────────────────────────────────────

export enum WagerTransactionKind {
  Opening  = "OPENING",   // interno: crédito de abertura da wallet
  Bet      = "BET",
  Win      = "WIN",
  Loss     = "LOSS",
  Refund   = "REFUND",
  Rollback = "ROLLBACK",
}

export enum WagerTransactionStatus {
  Pending          = "PENDING",            // aceita, ainda não aplicada
  PendingReference = "PENDING_REFERENCE",  // aguardando a transação referenciada
  Processed        = "PROCESSED",          // aplicada (terminal)
  Rejected         = "REJECTED",           // violação de regra de negócio (terminal)
  Failed           = "FAILED",             // erro permanente de infraestrutura (terminal)
}

export enum LedgerDirection {
  Debit  = "DEBIT",
  Credit = "CREDIT",
}

/**
 * Taxonomia estável de códigos de falha (Seções 7.2 e 9 do README).
 * Fornece motivos claros para os provedores quando uma aposta é rejeitada.
 */
export enum FailureCode {
  InsufficientFunds            = "INSUFFICIENT_FUNDS",
  ReferenceNotFound            = "REFERENCE_NOT_FOUND",
  InvalidReferenceState        = "INVALID_REFERENCE_STATE",
  AlreadyReversed              = "ALREADY_REVERSED",
  CurrencyMismatch             = "CURRENCY_MISMATCH",
  PayloadMismatch              = "PAYLOAD_MISMATCH",
  InvalidAmount                = "INVALID_AMOUNT",
  NegativeBalanceDisallowed    = "NEGATIVE_BALANCE_DISALLOWED",
  InvalidReferenceKind         = "INVALID_REFERENCE_KIND",
}

// ─── Erros de Domínio ─────────────────────────────────────────

export class InvalidTransactionStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTransactionStateError";
  }
}

// ─── Tipos e Contratos ────────────────────────────────────────

export interface CreateWagerTransactionProps {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
}

export interface WagerTransactionState {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
  createdAt: Date;
  status: WagerTransactionStatus;
  referenceTransactionId?: string;
  failureCode?: FailureCode;
  processedAt?: Date;
}

// ─── Entidade / Aggregate ─────────────────────────────────────

export class WagerTransaction {
  private constructor(
    public readonly id: string,
    public readonly providerId: string,
    public readonly externalTransactionId: string,
    public readonly idempotencyKey: string,
    public readonly payloadHash: string,
    public readonly walletId: string,
    public readonly playerId: string,
    public readonly roundId: string,
    public readonly gameId: string,
    public readonly kind: WagerTransactionKind,
    public readonly money: Money,
    public readonly referenceExternalTransactionId: string | undefined,
    public readonly createdAt: Date,
    private _status: WagerTransactionStatus,
    private _referenceTransactionId?: string,
    private _failureCode?: FailureCode,
    private _processedAt?: Date,
  ) {}

  /**
   * Factory method para criar nova transação a partir de requisição/evento.
   * Nasce sempre em estado PENDING.
   */
  static create(props: CreateWagerTransactionProps): WagerTransaction {
    // OPENING é exclusivamente de uso interno do sistema
    if (props.kind === WagerTransactionKind.Opening) {
      throw new Error("OPENING transactions cannot be created externally");
    }

    // REFUND e ROLLBACK exigem referência externa obrigatória
    if (
      (props.kind === WagerTransactionKind.Refund ||
       props.kind === WagerTransactionKind.Rollback) &&
      !props.referenceExternalTransactionId
    ) {
      throw new Error(`${props.kind} requires a referenceExternalTransactionId`);
    }

    const now = new Date();

    return new WagerTransaction(
      props.id,
      props.providerId,
      props.externalTransactionId,
      props.idempotencyKey,
      props.payloadHash,
      props.walletId,
      props.playerId,
      props.roundId,
      props.gameId,
      props.kind,
      props.money,
      props.referenceExternalTransactionId,
      now,
      WagerTransactionStatus.Pending,
      undefined, // ainda não resolvido
      undefined, // sem falhas ao nascer
      undefined, // ainda não processado
    );
  }

  /**
   * Factory method para reconstruir uma transação a partir do banco de dados.
   * Não revalida regras nem transições.
   */
  static rehydrate(state: WagerTransactionState): WagerTransaction {
    return new WagerTransaction(
      state.id,
      state.providerId,
      state.externalTransactionId,
      state.idempotencyKey,
      state.payloadHash,
      state.walletId,
      state.playerId,
      state.roundId,
      state.gameId,
      state.kind,
      state.money,
      state.referenceExternalTransactionId,
      state.createdAt,
      state.status,
      state.referenceTransactionId,
      state.failureCode,
      state.processedAt,
    );
  }

  // ─── Getters ────────────────────────────────────────────────

  get status(): WagerTransactionStatus {
    return this._status;
  }

  get referenceTransactionId(): string | undefined {
    return this._referenceTransactionId;
  }

  get failureCode(): FailureCode | undefined {
    return this._failureCode;
  }

  get processedAt(): Date | undefined {
    return this._processedAt;
  }

  // ─── Transições de Estado ───────────────────────────────────

  /**
   * Marca a transação como PROCESSED (estado terminal).
   */
  markProcessed(referenceTransactionId: string | undefined, at: Date): void {
    this.assertNotTerminal("markProcessed");
    this._status = WagerTransactionStatus.Processed;
    this._referenceTransactionId = referenceTransactionId;
    this._processedAt = at;

  }

  /**
   * Aguardando a chegada da transação referenciada (fora de ordem).
   */
  markPendingReference(): void {
    this.assertNotTerminal("markPendingReference");
    this._status = WagerTransactionStatus.PendingReference;
  }

  /**
   * Rejeita a transação por regra de negócio (estado terminal).
   */
  reject(code: FailureCode): void {
    this.assertNotTerminal("reject");
    this._status = WagerTransactionStatus.Rejected;
    this._failureCode = code;
    this._processedAt = new Date();
  }

  /**
   * Falha permanente de infraestrutura (estado terminal).
   */
  fail(code: FailureCode): void {
    this.assertNotTerminal("fail");
    this._status = WagerTransactionStatus.Failed;
    this._failureCode = code;
    this._processedAt = new Date();
  }

  // ─── Consultas de Domínio ───────────────────────────────────

  /**
   * Verifica se o estado é terminal (PROCESSED, REJECTED ou FAILED).
   */
  isTerminal(): boolean {
    return (
      this._status === WagerTransactionStatus.Processed ||
      this._status === WagerTransactionStatus.Rejected ||
      this._status === WagerTransactionStatus.Failed
    );
  }

  /**
   * Indica se a operação afeta saldo.
   * LOSS e transações rejeitadas não afetam o saldo.
   */
  affectsBalance(): boolean {
    if (this._status === WagerTransactionStatus.Rejected) return false;
    return this.kind !== WagerTransactionKind.Loss;
  }

  /**
   * REFUND e ROLLBACK exigem referência a uma operação anterior.
   */
  requiresReference(): boolean {
    return (
      this.kind === WagerTransactionKind.Refund ||
      this.kind === WagerTransactionKind.Rollback
    );
  }

  /**
   * Verifica se o hash recebido é igual ao armazenado (garantia de idempotência estrita).
   */
  matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  /**
   * Determina a direção contábil (DEBIT ou CREDIT) no ledger para esta transação.
   */
  ledgerDirectionFor(reference?: WagerTransaction): LedgerDirection {
    switch (this.kind) {
      case WagerTransactionKind.Bet:
        return LedgerDirection.Debit;

      case WagerTransactionKind.Opening:
      case WagerTransactionKind.Win:
      case WagerTransactionKind.Refund:
        return LedgerDirection.Credit;

      case WagerTransactionKind.Rollback: {
        if (!reference) {
          throw new Error("Rollback requires reference transaction to determine ledger direction");
        }
        // Inverte a direção da transação referenciada
        const refDirection = reference.ledgerDirectionFor();
        return refDirection === LedgerDirection.Debit
          ? LedgerDirection.Credit
          : LedgerDirection.Debit;
      }

      case WagerTransactionKind.Loss:
        throw new Error("LOSS does not produce a ledger entry");

      default:
        throw new Error(`Unsupported transaction kind: ${this.kind}`);
    }
  }

  private assertNotTerminal(action: string): void {
    if (this.isTerminal()) {
      throw new InvalidTransactionStateError(
        `Cannot execute ${action} on transaction ${this.id}: current status is terminal (${this._status})`
      );
    }
  }
}
