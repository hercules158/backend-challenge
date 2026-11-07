import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  BadRequestException,
  ConflictException,
  NotFoundException,
  Get,
  Param,
  Inject,
} from '@nestjs/common';
import {
  ProcessWagerUseCase,
  ProcessWagerInput,
  IdempotencyConflictError,
  WalletNotFoundError,
} from '../../../application/wagering/process-wager.use-case.js';
import { WagerTransactionKind } from '../../../domain/wagering/wager-transaction.js';
import { MoneyProps } from '../../../domain/shared/money.js';
import { WAGER_TRANSACTION_REPOSITORY_TOKEN, type IWagerTransactionRepository} from '../../../domain/wagering/wager-transaction.repository.interface.js';

export class ProcessWagerDto {
  providerId!: string;
  externalTransactionId!: string;
  playerId!: string;
  walletId!: string;
  roundId!: string;
  gameId!: string;
  kind!: WagerTransactionKind;
  money!: MoneyProps;
  referenceExternalTransactionId?: string;
}

@Controller('wagering')
export class WageringController {
  constructor(private readonly processWagerUseCase: ProcessWagerUseCase,
    @Inject(WAGER_TRANSACTION_REPOSITORY_TOKEN)
    private readonly wagerTransactionRepository: IWagerTransactionRepository
  ) {}

  /**
   * POST /wagering/transactions
   * Submete uma nova transação financeira (BET, WIN, LOSS, REFUND, ROLLBACK)
   */
  @Post('transactions')
  @HttpCode(HttpStatus.OK)
  async submitTransaction(
    @Headers('idempotency-key') idempotencyKeyHeader: string | undefined,
    @Body() dto: ProcessWagerDto,
  ) {
    const idempotencyKey = idempotencyKeyHeader || `${dto.providerId}:${dto.externalTransactionId}`;

    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required');
    }

    try {
      const input: ProcessWagerInput = {
        ...dto,
        idempotencyKey,
      };

      return await this.processWagerUseCase.execute(input);
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        throw new ConflictException(error.message);
      }
      if (error instanceof WalletNotFoundError) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }

    /**
     * GET /wagering/transaction/:transactionId
     * Consulta uma transação existente pelo seu ID.
     */
    @Get('transactions/:transactionId')
    async getTransaction(@Param('transactionId') transactionId: string) {
      const wager = await this.wagerTransactionRepository.findById(transactionId);
      if (!wager) {
        throw new NotFoundException(`Wager transaction ${transactionId} not found`);
      }
  
      return wager;
    }

    /**
   * GET /providers/:providerId/wagering/transactions/:externalTransactionId
   * Consulta uma transação pelo ID externo do provedor.
   */
    @Get('/providers/:providerId/wagering/transactions/:externalTransactionId')
    async getByExternalId(
      @Param('providerId') providerId: string,
      @Param('externalTranactionId') externalTransactionId: string,
    ) {
      const wager = await this.wagerTransactionRepository.findByProviderAndExternalId(
        providerId,
        externalTransactionId,
      );

      if (!wager) {
        throw new NotFoundException(
          `Transaction ${externalTransactionId} for provider ${providerId} not found`,
        );
      }

      return wager;
    }
}