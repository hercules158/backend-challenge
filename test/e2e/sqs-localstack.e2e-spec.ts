import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { SqsService } from '../../src/infrastructure/messaging/sqs/sqs.service.js';
import { EntityManager } from '@mikro-orm/postgresql';
import { WalletOrmEntity } from '../../src/infrastructure/database/mikro-orm/entities/wallet.orm-entity.js';
import { WagerTransactionOrmEntity } from '../../src/infrastructure/database/mikro-orm/entities/wager-transaction.orm-entity.js';
import { InboxMessageOrmEntity } from '../../src/infrastructure/database/mikro-orm/entities/inbox-message.orm-entity.js';
import { OutboxMessageOrmEntity } from '../../src/infrastructure/database/mikro-orm/entities/outbox-message.orm-entity.js';
import { LedgerEntryOrmEntity } from '../../src/infrastructure/database/mikro-orm/entities/ledger-entry.orm-entity.js';
import { randomUUID } from 'node:crypto';

describe('SQS + LocalStack + Database E2E Test', () => {
  let app: any;
  let sqsService: SqsService;
  let em: EntityManager;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    sqsService = moduleRef.get(SqsService);
    em = moduleRef.get(EntityManager);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('Health check do SQS deve responder saudável (status UP)', async () => {
    const isHealthy = await sqsService.checkHealth();
    expect(isHealthy).toBe(true);
  });

  it('Deve consumir mensagem SQS, debitar saldo na Wallet, gerar Ledger, gravar Inbox e enfileirar Outbox', async () => {
    const playerId = randomUUID();
    const walletId = randomUUID();
    const externalTransactionId = `tx-e2e-${randomUUID()}`;
    const messageId = `msg-sqs-${randomUUID()}`;

    // 1. Cria uma carteira com saldo inicial de R$ 100.00
    const forkEm = em.fork();
    const wallet = forkEm.create(WalletOrmEntity, {
      id: walletId,
      playerId,
      currency: 'BRL',
      balanceAmount: '100.00',
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await forkEm.persistAndFlush(wallet);

    // 2. Envia mensagem de aposta BET de R$ 30.00 para a fila SQS FIFO
    const wagerPayload = {
      messageId,
      type: 'WagerTransactionRequested',
      occurredAt: new Date().toISOString(),
      data: {
        providerId: 'provider-localstack',
        externalTransactionId,
        idempotencyKey: `provider-localstack:${externalTransactionId}`,
        playerId,
        walletId,
        roundId: 'round-e2e-1',
        gameId: 'fortune-tiger',
        kind: 'BET',
        money: { amount: '30.00', currency: 'BRL' },
      },
    };

    await sqsService.sendMessage({
      messageBody: JSON.stringify(wagerPayload),
      messageGroupId: walletId,
      messageDeduplicationId: messageId,
    });

    // 3. Aguarda o SqsConsumerService pegar da fila, processar e commitar no banco
    let processed = false;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const checkEm = em.fork();
      const updatedWallet = await checkEm.findOne(WalletOrmEntity, { id: walletId });
      if (updatedWallet && updatedWallet.balanceAmount === '70.00') {
        processed = true;
        break;
      }
    }

    expect(processed).toBe(true);

    // 4. Validações completas no banco de dados:
    const verifyEm = em.fork();

    // 4a. Saldo e versão da Wallet
    const updatedWallet = await verifyEm.findOneOrFail(WalletOrmEntity, { id: walletId });
    expect(updatedWallet.balanceAmount).toBe('70.00');
    expect(updatedWallet.version).toBe(2);

    // 4b. Transação Wager gravada como PROCESSED
    const wagerTx = await verifyEm.findOneOrFail(WagerTransactionOrmEntity, {
      externalTransactionId,
    });
    expect(wagerTx.status).toBe('PROCESSED');
    expect(wagerTx.moneyAmount).toBe('30.00');

    // 4c. Registro no Inbox gravado para deduplicação
    const inbox = await verifyEm.findOneOrFail(InboxMessageOrmEntity, {
      messageId,
    });
    expect(inbox.consumerName).toBe('wager-transaction-consumer');

    // 4d. Ledger entry gerado com DEBIT e matemática exata
    const ledger = await verifyEm.findOneOrFail(LedgerEntryOrmEntity, {
      walletId,
      transactionId: wagerTx.id,
    });
    expect(ledger.direction).toBe('DEBIT');
    expect(ledger.moneyAmount).toBe('30.00');
    expect(ledger.balanceBeforeAmount).toBe('100.00');
    expect(ledger.balanceAfterAmount).toBe('70.00');

    // 4e. Outbox messages geradas atomicamente
    const outboxEvents = await verifyEm.find(OutboxMessageOrmEntity, {
      aggregateId: wagerTx.id,
    });
    expect(outboxEvents.length).toBeGreaterThan(0);
  }, 25000); // timeout de 25s
});
