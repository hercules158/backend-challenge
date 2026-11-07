
export enum WalletTransactionKind {
  Opening  = "OPENING",   // interno: crédito de abertura da wallet
  Bet      = "BET",       // débito (aposta realizada)
  Win      = "WIN",       // crédito (prêmio de aposta)
  Refund   = "REFUND",    // crédito (estorno de aposta não realizada/cancelada)
  Adjustment = "ADJUSTMENT" // crédito ou débito (correção manual)
}