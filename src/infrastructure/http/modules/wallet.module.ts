import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { WalletController } from '../controllers/wallet.controller.js';
import { CreateWalletUseCase } from '../../../application/wallet/create-wallet.use-case.js';
import { ReconcileWalletUseCase } from '../../../application/wallet/reconcile-wallet.use-case.js';
import { WALLET_REPOSITORY_TOKEN } from '../../../domain/wallet/wallet.repository.interface.js';
import { LEDGER_REPOSITORY_TOKEN } from '../../../domain/ledger/ledger.repository.interface.js';
import { WalletOrmEntity } from '../../database/mikro-orm/entities/wallet.orm-entity.js';
import { LedgerEntryOrmEntity } from '../../database/mikro-orm/entities/ledger-entry.orm-entity.js';
import { MikroOrmWalletRepository } from '../../database/mikro-orm/repositories/mikro-orm-wallet.repository.js';
import { MikroOrmLedgerRepository } from '../../database/mikro-orm/repositories/mikro-orm-ledger.repository.js';

@Module({
  imports: [
    MikroOrmModule.forFeature([WalletOrmEntity, LedgerEntryOrmEntity]),
  ],
  controllers: [WalletController],
  providers: [
    MikroOrmWalletRepository,
    MikroOrmLedgerRepository,
    ReconcileWalletUseCase,
    {
      provide: WALLET_REPOSITORY_TOKEN,
      useExisting: MikroOrmWalletRepository,
    },
    {
      provide: LEDGER_REPOSITORY_TOKEN,
      useExisting: MikroOrmLedgerRepository,
    },
    {
      provide: CreateWalletUseCase,
      useFactory: (walletRepo: MikroOrmWalletRepository, ledgerRepo: MikroOrmLedgerRepository) =>
        new CreateWalletUseCase(walletRepo, ledgerRepo),
      inject: [MikroOrmWalletRepository, MikroOrmLedgerRepository],
    },
  ],
  exports: [WALLET_REPOSITORY_TOKEN, LEDGER_REPOSITORY_TOKEN, CreateWalletUseCase, ReconcileWalletUseCase],
})
export class WalletModule {}
