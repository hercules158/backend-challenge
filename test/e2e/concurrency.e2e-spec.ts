import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { ProcessWagerUseCase } from '../../src/application/wagering/process-wager.use-case.js';
import { CreateWalletUseCase } from '../../src/application/wallet/create-wallet.use-case.js';
import { ReconcileWalletUseCase } from '../../src/application/wallet/reconcile-wallet.use-case.js';
import { EntityManager } from '@mikro-orm/postgresql';
import { WalletOrmEntity } from '../../src/infrastructure/database/mikro-orm/entities/wallet.orm-entity.js';
import { LedgerEntryOrmEntity } from '../../src/infrastructure/database/mikro-orm/entities/ledger-entry.orm-entity.js';
import { WagerTransactionOrmEntity } from '../../src/infrastructure/database/mikro-orm/entities/wager-transaction.orm-entity.js';
import { WagerTransactionKind, WagerTransactionStatus, FailureCode } from '../../src/domain/wagering/wager-transaction.js';
import { randomUUID } from 'node:crypto';

describe('Testes de Concorrência e Invariantes Financeiras (Seções 8 e 13)', () => {
  let app: any;
  let processWagerUseCase: ProcessWagerUseCase;
  let createWalletUseCase: CreateWalletUseCase;
  let reconcileWalletUseCase: ReconcileWalletUseCase;
  let em: EntityManager;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    processWagerUseCase = moduleRef.get(ProcessWagerUseCase);
    createWalletUseCase = moduleRef.get(CreateWalletUseCase);
    reconcileWalletUseCase = moduleRef.get(ReconcileWalletUseCase);
    em = moduleRef.get(EntityManager);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('Cenário Obrigatório: Saldo inicial 100.00, duas apostas de 80.00 disparadas simultaneamente', async () => {
    const playerId = randomUUID();

    // 1. Abre a carteira com R$ 100.00 inicial
    const wallet = await createWalletUseCase.execute({
      playerId,
      currency: 'BRL',
      initialBalance: { amount: '100.00', currency: 'BRL' },
    });

    const walletId = wallet.id;

    // 2. Dispara 2 apostas de R$ 80.00 simultâneas disputando o saldo
    const op1 = processWagerUseCase.execute({
      providerId: 'provider-concurrency',
      externalTransactionId: `bet-a-${randomUUID()}`,
      idempotencyKey: `key-a-${randomUUID()}`,
      playerId,
      walletId,
      roundId: 'round-race-1',
      gameId: 'fortune-ox',
      kind: WagerTransactionKind.Bet,
      money: { amount: '80.00', currency: 'BRL' },
    });

    const op2 = processWagerUseCase.execute({
      providerId: 'provider-concurrency',
      externalTransactionId: `bet-b-${randomUUID()}`,
      idempotencyKey: `key-b-${randomUUID()}`,
      playerId,
      walletId,
      roundId: 'round-race-1',
      gameId: 'fortune-ox',
      kind: WagerTransactionKind.Bet,
      money: { amount: '80.00', currency: 'BRL' },
    });

    const [res1, res2] = await Promise.all([op1, op2]);

    // 3. Exatamente 1 deve ser PROCESSED e 1 deve ser REJECTED
    const statuses = [res1.status, res2.status];
    expect(statuses).toContain(WagerTransactionStatus.Processed);
    expect(statuses).toContain(WagerTransactionStatus.Rejected);

    const rejectedRes = res1.status === WagerTransactionStatus.Rejected ? res1 : res2;
    expect(rejectedRes.failureCode).toBe(FailureCode.InsufficientFunds);

    // 4. Saldo final materializado na Wallet deve ser exatamente R$ 20.00
    const checkEm = em.fork();
    const updatedWallet = await checkEm.findOneOrFail(WalletOrmEntity, { id: walletId });
    expect(updatedWallet.balanceAmount).toBe('20.00');

    // 5. Invariante do Ledger: exatamente 2 lançamentos (1 OPENING de 100.00 + 1 DEBIT de 80.00)
    const ledgerEntries = await checkEm.find(LedgerEntryOrmEntity, { walletId });
    expect(ledgerEntries.length).toBe(2);

    // 6. Reconciliação: wallet.balance == saldo recalculado pelo Ledger
    const reconciliation = await reconcileWalletUseCase.execute(walletId);
    expect(reconciliation.consistent).toBe(true);
    expect(reconciliation.difference.amount).toBe('0.00');
    expect(reconciliation.calculatedBalance.amount).toBe('20.00');
    expect(reconciliation.storedBalance.amount).toBe('20.00');
  });

  it('Cenário de Idempotência sob Carga: a mesma aposta enviada 50 vezes em paralelo -> 1 único débito', async () => {
    const playerId = randomUUID();

    // 1. Cria carteira com R$ 1000.00
    const wallet = await createWalletUseCase.execute({
      playerId,
      currency: 'BRL',
      initialBalance: { amount: '1000.00', currency: 'BRL' },
    });

    const walletId = wallet.id;
    const idempotencyKey = `idemp-load-test-${randomUUID()}`;
    const externalTransactionId = `ext-load-${randomUUID()}`;

    // 2. Prepara 50 chamadas com a MESMA chave de idempotência e mesmo payload
    const promises = Array.from({ length: 50 }, () =>
      processWagerUseCase.execute({
        providerId: 'provider-load',
        externalTransactionId,
        idempotencyKey,
        playerId,
        walletId,
        roundId: 'round-load-1',
        gameId: 'fortune-mouse',
        kind: WagerTransactionKind.Bet,
        money: { amount: '15.00', currency: 'BRL' },
      }),
    );

    // 3. Executa as 50 chamadas em paralelo
    const results = await Promise.all(promises);

    // 4. Todas as 50 respostas devem retornar o mesmo transactionId
    const firstTxId = results[0].transactionId;
    expect(results.every((r) => r.transactionId === firstTxId)).toBe(true);

    // Todas devem ter status PROCESSED
    expect(results.every((r) => r.status === WagerTransactionStatus.Processed)).toBe(true);

    // Exatamente 1 chamada é a pioneira (idempotentReplay: false) e 49 são replay (idempotentReplay: true)
    const replays = results.filter((r) => r.idempotentReplay);
    expect(replays.length).toBe(49);

    // 5. Saldo final deve ter sido debitado APENAS UMA VEZ (1000 - 15 = 985.00)
    const checkEm = em.fork();
    const updatedWallet = await checkEm.findOneOrFail(WalletOrmEntity, { id: walletId });
    expect(updatedWallet.balanceAmount).toBe('985.00');

    // 6. No ledger, deve haver apenas 2 lançamentos (OPENING de 1000.00 + 1 único DEBIT de 15.00)
    const ledgerEntries = await checkEm.find(LedgerEntryOrmEntity, { walletId });
    expect(ledgerEntries.length).toBe(2);

    // 7. Reconciliação do Ledger
    const reconciliation = await reconcileWalletUseCase.execute(walletId);
    expect(reconciliation.consistent).toBe(true);
    expect(reconciliation.storedBalance.amount).toBe('985.00');
    expect(reconciliation.calculatedBalance.amount).toBe('985.00');
  });

  it('Wallets distintas sendo processadas em paralelo sem interferência', async () => {
    const numWallets = 10;
    const walletIds: string[] = [];

    // Cria 10 wallets distintas com R$ 100 cada
    for (let i = 0; i < numWallets; i++) {
      const w = await createWalletUseCase.execute({
        playerId: randomUUID(),
        currency: 'BRL',
        initialBalance: { amount: '100.00', currency: 'BRL' },
      });
      walletIds.push(w.id);
    }

    // Dispara 1 aposta de R$ 10.00 para cada uma das 10 wallets em paralelo
    const parallelBets = walletIds.map((walletId, idx) =>
      processWagerUseCase.execute({
        providerId: 'provider-parallel',
        externalTransactionId: `bet-multi-${idx}-${randomUUID()}`,
        idempotencyKey: `key-multi-${idx}-${randomUUID()}`,
        playerId: randomUUID(),
        walletId,
        roundId: `round-multi-${idx}`,
        gameId: 'fortune-rabbit',
        kind: WagerTransactionKind.Bet,
        money: { amount: '10.00', currency: 'BRL' },
      }),
    );

    const betResults = await Promise.all(parallelBets);

    // Todas as 10 devem ter sido processadas com sucesso
    expect(betResults.every((r) => r.status === WagerTransactionStatus.Processed)).toBe(true);

    // Cada carteira deve ter saldo exato de 90.00
    const checkEm = em.fork();
    for (const walletId of walletIds) {
      const w = await checkEm.findOneOrFail(WalletOrmEntity, { id: walletId });
      expect(w.balanceAmount).toBe('90.00');

      const reconciliation = await reconcileWalletUseCase.execute(walletId);
      expect(reconciliation.consistent).toBe(true);
      expect(reconciliation.storedBalance.amount).toBe('90.00');
    }
  });
});

