import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  ConflictException,
  BadRequestException,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import { CreateWalletUseCase, WalletAlreadyExistsError } from '../../../application/wallet/create-wallet.use-case.js';
import { ReconcileWalletUseCase } from '../../../application/wallet/reconcile-wallet.use-case.js';
import { InvalidMoneyError } from '../../../domain/shared/money.js';
import { WALLET_REPOSITORY_TOKEN, type IWalletRepository } from '../../../domain/wallet/wallet.repository.interface.js';
import { LEDGER_REPOSITORY_TOKEN, type ILedgerRepository } from '../../../domain/ledger/ledger.repository.interface.js';

// DTO de entrada esperado no corpo do POST /wallets
export class CreateWalletDto {
  playerId!: string;
  initialBalance!: {
    amount: string;
    currency: string;
  };
}

@Controller('wallets')
export class WalletController {
  constructor(
    @Inject('CreateWalletUseCase')
    private readonly createWalletUseCase: CreateWalletUseCase,
    @Inject(WALLET_REPOSITORY_TOKEN)
    private readonly walletRepository: IWalletRepository,
    @Inject(LEDGER_REPOSITORY_TOKEN)
    private readonly ledgerRepository: ILedgerRepository,
    private readonly reconcileWalletUseCase: ReconcileWalletUseCase,
  ) {}

  /**
   * POST /wallets
   * Cria uma nova carteira para o jogador.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createWallet(@Body() dto: CreateWalletDto) {
    try {
      return await this.createWalletUseCase.execute(dto);
    } catch (error) {
      if (error instanceof WalletAlreadyExistsError) {
        throw new ConflictException(
          {
            statusCode: 409,
            message: error.message,
            error: "Conflict",
        existingWalletId: error.existingWalletId,
      });
      }
      if (error instanceof InvalidMoneyError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  /**
   * GET /wallets/:walletId
   * Consulta uma carteira existente pelo seu ID.
   */
  @Get(':walletId')
  async getWallet(@Param('walletId') walletId: string) {
    const wallet = await this.walletRepository.findById(walletId);
    if (!wallet) {
      throw new NotFoundException(`Wallet ${walletId} not found`);
    }

    return {
      id: wallet.id,
      playerId: wallet.playerId,
      balance: wallet.balance.toJSON(),
      version: wallet.version,
    };
  }

  /**
   * GET /wallets/:walletId/ledger?cursor=...&limit=50
   * Retorna os lançamentos contábeis paginados por cursor.
   */
  @Get(':walletId/ledger')
  async getLedger(
    @Param('walletId') walletId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limitStr?: string,
  ) {
    const wallet = await this.walletRepository.findById(walletId);
    if (!wallet) {
      throw new NotFoundException(`Wallet ${walletId} not found`);
    }

    const limit = limitStr ? Math.min(Math.max(parseInt(limitStr, 10), 1), 100) : 50;
    const paginated = await this.ledgerRepository.findEntriesByWalletId(walletId, cursor, limit);

    return {
      items: paginated.items.map(entry => ({
        id: entry.id,
        walletId: entry.walletId,
        transactionId: entry.transactionId,
        direction: entry.direction,
        money: entry.money.toJSON(),
        balanceBefore: entry.balanceBefore.toJSON(),
        balanceAfter: entry.balanceAfter.toJSON(),
        createdAt: entry.createdAt.toISOString(),
      })),
      nextCursor: paginated.nextCursor,
    };
  }

  /**
   * POST /wallets/:walletId/reconciliation
   * Executa a auditoria e reconciliação entre saldo armazenado e ledger.
   */
  @Post(':walletId/reconciliation')
  @HttpCode(HttpStatus.OK)
  async reconcileWallet(@Param('walletId') walletId: string) {
    return await this.reconcileWalletUseCase.execute(walletId);
  }
}
