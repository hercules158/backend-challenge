import { describe, it, expect, mock } from 'bun:test';
import { SqsConsumerService, SQS_CONSUMER_NAME } from '../../../src/infrastructure/messaging/sqs/sqs-consumer.service.js';

describe('SqsConsumerService', () => {
  it('deve processar mensagem e dar ack (deleteMessage) somente após sucesso', async () => {
    let deletedHandle: string | null = null;
    let processedInput: any = null;

    const mockSqsService: any = {
      deleteMessage: mock(async (handle: string) => {
        deletedHandle = handle;
      }),
      changeVisibility: mock(async () => {}),
    };

    const mockProcessWagerUseCase: any = {
      execute: mock(async (input: any) => {
        processedInput = input;
        return { transactionId: 'tx-1', status: 'PROCESSED' };
      }),
    };

    const mockEm: any = {
      fork: () => ({
        findOne: mock(async () => null), // não existe no Inbox ainda
      }),
    };

    const service = new SqsConsumerService(mockSqsService, mockProcessWagerUseCase, mockEm);

    const testMessage: any = {
      MessageId: 'sqs-msg-123',
      ReceiptHandle: 'handle-abc',
      Body: JSON.stringify({
        messageId: 'msg-external-1',
        type: 'WagerTransactionRequested',
        data: {
          providerId: 'provider-test',
          externalTransactionId: 'ext-tx-1',
          idempotencyKey: 'key-1',
          playerId: 'player-1',
          walletId: 'wallet-1',
          roundId: 'round-1',
          gameId: 'game-1',
          kind: 'BET',
          money: { amount: '25.00', currency: 'BRL' },
        },
      }),
    };

    await service.processMessage(testMessage);

    // Verificações
    expect(mockProcessWagerUseCase.execute).toHaveBeenCalled();
    expect(processedInput.inboxMessageId).toBe('msg-external-1');
    expect(processedInput.consumerName).toBe(SQS_CONSUMER_NAME);
    expect(deletedHandle).toBe('handle-abc');
  });

  it('deve descartar e dar ack diretamente se mensagem já estiver no Inbox', async () => {
    let deletedHandle: string | null = null;

    const mockSqsService: any = {
      deleteMessage: mock(async (handle: string) => {
        deletedHandle = handle;
      }),
    };

    const mockProcessWagerUseCase: any = {
      execute: mock(async () => {}),
    };

    const mockEm: any = {
      fork: () => ({
        findOne: mock(async () => ({ id: 'existing-inbox-id' })), // já existe no Inbox
      }),
    };

    const service = new SqsConsumerService(mockSqsService, mockProcessWagerUseCase, mockEm);

    const testMessage: any = {
      MessageId: 'sqs-msg-123',
      ReceiptHandle: 'handle-dup',
      Body: JSON.stringify({
        messageId: 'msg-external-dup',
        data: {
          providerId: 'p1',
          externalTransactionId: 'ext-1',
        },
      }),
    };

    await service.processMessage(testMessage);

    // O usecase não deve ser chamado para duplicata de inbox
    expect(mockProcessWagerUseCase.execute).not.toHaveBeenCalled();
    expect(deletedHandle).toBe('handle-dup');
  });
});

