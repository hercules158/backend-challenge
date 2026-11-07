import { WalletLedgerEntry } from "./wallet-ledger-entry.js";

export interface PaginatedLedgerEntries {
  items: WalletLedgerEntry[];
  nextCursor?: string;
}

export interface ILedgerRepository {
  save(entry: WalletLedgerEntry): Promise<void>;
  
  /**
   * Busca entradas de ledger de uma carteira com paginação por cursor.
   * Ordenado do mais recente para o mais antigo.
   */
  findEntriesByWalletId(
    walletId: string,
    cursor?: string,
    limit?: number,
  ): Promise<PaginatedLedgerEntries>;

  /**
   * Busca todas as entradas para auditoria e reconciliação contábil (em ordem cronológica).
   */
  findAllByWalletId(walletId: string): Promise<WalletLedgerEntry[]>;
}

export const LEDGER_REPOSITORY_TOKEN = Symbol('ILedgerRepository');
