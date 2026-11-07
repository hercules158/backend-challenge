import { Wallet } from "./wallet.js";

export interface IWalletRepository {
    findById(id: string): Promise<Wallet | null>;
    findByPlayerIdAndCurrency(playerId: string, currency: string): Promise<Wallet | null>;
    save(wallet: Wallet): Promise<void>;
}

export const WALLET_REPOSITORY_TOKEN = Symbol('IWalletRepository');