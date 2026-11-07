import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  ConflictException,
  BadRequestException,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import { CreateWalletUseCase, WalletAlreadyExistsError } from '../../../application/wallet/create-wallet.use-case.js';
import { InvalidMoneyError } from '../../../domain/shared/money.js';
import { WALLET_REPOSITORY_TOKEN, type IWalletRepository } from '../../../domain/wallet/wallet.repository.interface.js';

// DTO de entrada esperado no corpo do POST /wallets
export class CreateWalletDto {
  playerId: string;
  initialBalance: {
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
        throw new ConflictException(error.message);
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
}
