import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { SqsService } from './sqs.service.js';
import { ProcessWagerUseCase } from '../../../application/wagering/process-wager.use-case.js';
import { InboxMessageOrmEntity } from '../../database/mikro-orm/entities/inbox-message.orm-entity.js';
import type { Message } from '@aws-sdk/client-sqs';

export const SQS_CONSUMER_NAME = 'wager-transaction-consumer';

@Injectable()
export class SqsConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SqsConsumerService.name);
  private isRunning = false;
  private shouldStop = false;
  private activeProcessingPromise?: Promise<void>;

  constructor(
    private readonly sqsService: SqsService,
    private readonly processWagerUseCase: ProcessWagerUseCase,
    private readonly em: EntityManager,
  ) {}

  onModuleInit() {
    this.startPolling();
  }

  async onModuleDestroy() {
    await this.stopPolling();
  }

  startPolling() {
    this.isRunning = true;
    this.shouldStop = false;
    this.logger.log('Starting SQS Consumer polling loop...');

    // Inicia loop assíncrono em background
    this.activeProcessingPromise = this.pollLoop().catch((err) => {
      this.logger.error(`Fatal error in SQS poll loop: ${err.message}`, err.stack);
    });
  }

  async stopPolling() {
    this.logger.log('Stopping SQS Consumer...');
    this.shouldStop = true;
    if (this.activeProcessingPromise) {
      await this.activeProcessingPromise;
    }
    this.isRunning = false;
    this.logger.log('SQS Consumer stopped gracefully.');
  }

  private async pollLoop() {
    while (!this.shouldStop) {
      try {
        const messages = await this.sqsService.receiveMessages({
          maxNumberOfMessages: 10,
          waitTimeSeconds: 20, // long-polling
          visibilityTimeout: 30,
        });

        if (messages && messages.length > 0) {
          for (const message of messages) {
            if (this.shouldStop) {
              // Se foi solicitado desligamento, devolve a visibilidade para outro worker pegar
              if (message.ReceiptHandle) {
                await this.sqsService.changeVisibility(message.ReceiptHandle, 0);
              }
              continue;
            }

            await this.processMessage(message);
          }
        }
      } catch (err: any) {
        if (!this.shouldStop) {
          this.logger.error(`Error polling SQS messages: ${err.message}`);
          // Pequena pausa para evitar flood em caso de falha de rede contínua
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
    }
  }

  /**
   * Processa uma única mensagem da fila com Inbox Pattern e Ack pós-commit
   */
  async processMessage(message: Message): Promise<void> {
    if (!message.Body || !message.ReceiptHandle) {
      return;
    }

    let parsedBody: any;
    try {
      parsedBody = JSON.parse(message.Body);
    } catch {
      this.logger.error(`Invalid JSON body in SQS message ${message.MessageId}. Deleting message.`);
      // Mensagem corrompida não adianta retry; deleta
      await this.sqsService.deleteMessage(message.ReceiptHandle);
      return;
    }

    // Se for mensagem envelope do tipo WagerTransactionRequested (README seção 10)
    const wagerData = parsedBody.data || parsedBody;
    const messageId = parsedBody.messageId || message.MessageId || 'unknown-msg-id';

    // 1. Verificação prévia de Inbox (Deduplicação persistente)
    const isAlreadyProcessed = await this.checkInbox(messageId);
    if (isAlreadyProcessed) {
      this.logger.warn(`Message ${messageId} already processed in Inbox. Acknowledging duplicate.`);
      await this.sqsService.deleteMessage(message.ReceiptHandle);
      return;
    }

    try {
      // 2. Executa Use Case (atômico: Inbox + Wager + Wallet + Ledger + Outbox)
      await this.processWagerUseCase.execute({
        idempotencyKey: wagerData.idempotencyKey || `${wagerData.providerId}:${wagerData.externalTransactionId}`,
        providerId: wagerData.providerId,
        externalTransactionId: wagerData.externalTransactionId,
        playerId: wagerData.playerId,
        walletId: wagerData.walletId,
        roundId: wagerData.roundId,
        gameId: wagerData.gameId,
        kind: wagerData.kind,
        money: wagerData.money,
        referenceExternalTransactionId: wagerData.referenceExternalTransactionId,
        correlationId: parsedBody.correlationId || messageId,
        causationId: messageId,
        inboxMessageId: messageId,
        consumerName: SQS_CONSUMER_NAME,
      });

      // 3. Ack SOMENTE após commit
      await this.sqsService.deleteMessage(message.ReceiptHandle);
      this.logger.log(`Message ${messageId} processed and acknowledged successfully.`);
    } catch (err: any) {
      // Se for conflito de chave de idempotência ou erro conhecido de negócio,
      // consideramos terminal (não repete para sempre no SQS)
      if (err.name === 'IdempotencyConflictError') {
        this.logger.warn(`Idempotency conflict for message ${messageId}: ${err.message}. Acknowledging.`);
        await this.sqsService.deleteMessage(message.ReceiptHandle);
        return;
      }

      // Se for erro transitório (ex: timeout de banco, deadlock), devolve a visibilidade
      this.logger.error(`Failed to process message ${messageId}: ${err.message}. Releasing visibility.`);
      try {
        await this.sqsService.changeVisibility(message.ReceiptHandle, 0);
      } catch (visErr: any) {
        this.logger.error(`Failed to change message visibility: ${visErr.message}`);
      }
    }
  }

  private async checkInbox(messageId: string): Promise<boolean> {
    const forkEm = this.em.fork();
    const existing = await forkEm.findOne(InboxMessageOrmEntity, {
      messageId,
      consumerName: SQS_CONSUMER_NAME,
    });
    return !!existing;
  }
}

