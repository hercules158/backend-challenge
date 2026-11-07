import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { WalletController } from '../controllers/wallet.controller.js';
import { CreateWalletUseCase } from '../../../application/wallet/create-wallet.use-case.js';
import { WALLET_REPOSITORY_TOKEN } from '../../../domain/wallet/wallet.repository.interface.js';
import { WalletOrmEntity } from '../../database/mikro-orm/entities/wallet.orm-entity.js';
import { LedgerEntryOrmEntity } from '../../database/mikro-orm/entities/ledger-entry.orm-entity.js';
import { MikroOrmWalletRepository } from '../../database/mikro-orm/repositories/mikro-orm-wallet.repository.js';
import { MikroOrmLedgerRepository } from '../../database/mikro-orm/repositories/ledger.repository.js';

@Module({
  imports: [
    MikroOrmModule.forFeature([WalletOrmEntity, LedgerEntryOrmEntity]),
  ],
  controllers: [WalletController],
  providers: [
    MikroOrmWalletRepository,
    MikroOrmLedgerRepository,
    {
      provide: WALLET_REPOSITORY_TOKEN,
      useExisting: MikroOrmWalletRepository,
    },
    {
      provide: 'CreateWalletUseCase',
      useFactory: (walletRepo: MikroOrmWalletRepository, ledgerRepo: MikroOrmLedgerRepository) =>
        new CreateWalletUseCase(walletRepo, ledgerRepo),
      inject: [MikroOrmWalletRepository, MikroOrmLedgerRepository],
    },
  ],
  exports: [WALLET_REPOSITORY_TOKEN, 'CreateWalletUseCase'],
})
export class WalletModule {}
