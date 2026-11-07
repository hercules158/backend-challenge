import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { WageringController } from '../controllers/wagering.controller.js';
import { ProcessWagerUseCase } from '../../../application/wagering/process-wager.use-case.js';
import { WagerTransactionOrmEntity } from '../../database/mikro-orm/entities/wager-transaction.orm-entity.js';
import { WalletOrmEntity } from '../../database/mikro-orm/entities/wallet.orm-entity.js';
import { LedgerEntryOrmEntity } from '../../database/mikro-orm/entities/ledger-entry.orm-entity.js';
import { MikroOrmWagerTransactionRepository } from '../../database/mikro-orm/repositories/mikro-orm-wager-transaction.repository.js';
import { WAGER_TRANSACTION_REPOSITORY_TOKEN } from '../../../domain/wagering/wager-transaction.repository.interface.js';
import { WALLET_REPOSITORY_TOKEN } from '../../../domain/wallet/wallet.repository.interface.js';
import { MikroOrmWalletRepository } from '../../database/mikro-orm/repositories/mikro-orm-wallet.repository.js';

@Module({
  imports: [
    MikroOrmModule.forFeature([
      WagerTransactionOrmEntity,
      WalletOrmEntity,
      LedgerEntryOrmEntity,
    ]),
  ],
  controllers: [WageringController],
  providers: [
    ProcessWagerUseCase,
    MikroOrmWagerTransactionRepository,
    MikroOrmWalletRepository,
    {
      provide: WAGER_TRANSACTION_REPOSITORY_TOKEN,
      useExisting: MikroOrmWagerTransactionRepository,
    },
    {
      provide: WALLET_REPOSITORY_TOKEN,
      useExisting: MikroOrmWalletRepository,
    },
  ],
  exports: [ProcessWagerUseCase],
})
export class WageringModule {}

