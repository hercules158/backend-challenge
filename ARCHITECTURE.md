# Arquitetura e Decisões de Engenharia — Wagering Processor

Este documento descreve as decisões de arquitetura, trade-offs, modelagem de domínio (DDD) e estratégias de concorrência e resiliência adotadas no processador financeiro distribuído da Jungle Gaming.

---

## 1. Visão Geral da Arquitetura

O sistema adota os princípios de **Domain-Driven Design (DDD)** e **Hexagonal Architecture (Ports and Adapters)**, garantindo que o núcleo do negócio permaneça completamente isolado de frameworks, bibliotecas de persistência e detalhes de infraestrutura.

### Divisão de Camadas:
- **`src/domain/`**: Entidades puras, agregados, Value Objects (`Money`) e contratos de repositórios. **Livre de decorators do NestJS ou MikroORM**.
- **`src/application/`**: Casos de uso orquestrando o fluxo transacional (`ProcessWagerUseCase`, `CreateWalletUseCase`, `ReconcileWalletUseCase`).
- **`src/infrastructure/`**: Adapters secundários e primários:
  - `database/mikro-orm/`: Mapeamento relacional (ORM entities), migrations e implementação de repositórios.
  - `messaging/`: Clientes SQS (Producer & Consumer), deduplicação com Inbox Pattern.
  - `outbox/`: Worker transacional com `SKIP LOCKED`.
  - `http/`: Controllers REST, DTOs e validações.
  - `logging/`: Logger estruturado em JSON com mascaramento (Pino).

---

## 2. Decisão de Persistência: MikroORM v6

Optei pelo **MikroORM v6** devido à exigência do desafio e também pelos seguintes motivos técnicos:
1. **Padrão Unit of Work e Identity Map**: Garante que alterações em entidades sejam rastreadas e sincronizadas atomicamente com o banco.
2. **Suporte Nativo a Pessimistic Locking**: Permite o uso direto de `LockMode.PESSIMISTIC_WRITE` (`SELECT ... FOR UPDATE`), fundamental para o isolamento financeiro.
3. **Controle Total de SQL e Knex**: Acesso direto ao query builder Knex subjacente, permitindo consultas avançadas como `FOR UPDATE SKIP LOCKED` para o Outbox Worker concorrente entre réplicas.
4. **Isolamento de Domínio**: As entidades do MikroORM (`*OrmEntity`) atuam puramente na camada de infraestrutura, desacopladas dos Agregados de Domínio por factories de reidratação (`rehydrate`).

---

## 3. Concorrência e Isolamento Financeiro

### Unidade de Concorrência: `walletId`
A unidade de bloqueio e concorrência é estritamente o `walletId`. Nenhuma transação pode mover saldo de uma carteira sem adquirir previamente o lock exclusivo sobre o registro daquela carteira.

### Estratégia de Bloqueio: Pessimistic Write Locking (`SELECT FOR UPDATE`)
```ts
const walletOrm = await em.findOne(
  WalletOrmEntity,
  { id: input.walletId },
  { lockMode: LockMode.PESSIMISTIC_WRITE },
);
```
- **Por que Pessimistic Locking?** Em sistemas de alta disputa por saldo ("hot wallet" ou múltiplos giros simultâneos na mesma rodada), abordagens com Optimistic Locking sofrem com altas taxas de rollback, desperdício de CPU e tempestades de retries. O bloqueio pessimista serializa as movimentações na fila do PostgreSQL por wallet, eliminando lost updates e garantindo latência previsível.
- **Granularidade**: O lock é por linha (`WHERE id = walletId`), permitindo que milhares de wallets diferentes operem 100% em paralelo sem bloqueio mútuo.

### Cenário Obrigatório (R$ 100 saldo, 2 apostas de R$ 80):
1. Ambas as requisições chegam simultaneamente.
2. O PostgreSQL concede o lock para a primeira requisição.
3. A requisição 1 debita R$ 80, atualiza o saldo para R$ 20, gera o lançamento no Ledger e faz o commit.
4. A requisição 2 obtém o lock imediatamente após o commit da primeira, faz rehydrate do saldo atualizado (R$ 20), verifica saldo insuficiente, rejeita a aposta auditavelmente (`status = REJECTED`, `failureCode = INSUFFICIENT_FUNDS`), e commita sem alterar saldo nem ledger.
5. Invariante final comprovada: Saldo = R$ 20.00, 1 lançamento no Ledger, Reconciliação com 0.00 de discrepância.

---

## 4. Idempotência Persistente e Hash Canônico

A idempotência é garantida em dois níveis e não depende de cache em memória:

1. **Header `Idempotency-Key` e Hash Canônico SHA-256**:
   - Cada requisição gera um hash SHA-256 a partir de uma estrutura canônica contendo os campos de negócio ordenados (`externalTransactionId`, `gameId`, `kind`, `money`, `playerId`, `providerId`, `roundId`, `walletId`).
   - Replay com o mesmo hash: retorna a resposta original registrada (`idempotentReplay: true`).
   - Replay com a mesma chave mas payload divergente: rejeição imediata com `IdempotencyConflictError` (HTTP 409).
2. **Double-Check sob Lock Transacional**:
   - Para evitar race conditions onde 50 requisições simultâneas com a mesma chave passem pela pré-verificação antes do primeiro commit, a verificação de idempotência é repetida **dentro da transação SQL sob o lock exclusivo da wallet**.
   - Isso garante que apenas 1 processo execute a escrita pioneira e todos os outros 49 recebam replay idempotente sem lançamentos duplicados no banco.

---

## 5. Mensageria, Outbox e Inbox Pattern

### 5.1 Transactional Outbox Pattern
Para evitar o problema de consistência dual (*dual-write problem*), o envio para a mensageria nunca ocorre antes do commit do banco.

- A alteração na carteira, lançamento no ledger, registro da transação e os eventos de integração (`WagerTransactionProcessed`, `WalletBalanceChanged`, etc.) são persistidos **na mesma transação SQL**.
- Um **`OutboxWorker`** roda em background com polling a cada 1 segundo e executa:
  ```sql
  SELECT * FROM outbox_messages
  WHERE published_at IS NULL AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
  ORDER BY occurred_at ASC
  LIMIT 50
  FOR UPDATE SKIP LOCKED;
  ```
  - `FOR UPDATE SKIP LOCKED` assegura que múltiplas instâncias do worker processem lotes distintos simultaneamente sem disputas de lock nem publicações duplicadas redundantes.
  - O evento é publicado no SQS FIFO e, após confirmação, o worker marca `published_at = NOW()`.
  - Em falha de publicação, aplica backoff exponencial com teto de 60 segundos (`scheduleRetry`).

### 5.2 Inbox Pattern e SQS Consumer
- O consumidor lê mensagens da fila `wager-transactions.fifo` via long polling.
- Deduplicação via tabela `inbox_messages` chaveada por `(consumer_name, message_id)`.
- **Ack pós-commit**: O comando `deleteMessage` só é disparado no SQS após a transação SQL ser confirmada com sucesso.
- Se o worker morrer após o commit e antes do ack, o redelivery do SQS será absorvido com segurança pelo Inbox sem aplicar débito duplicado.
- Mensagens que falham permanentemente (ex: 5 retries esgotados) são encaminhadas automaticamente para a `wager-transactions-dlq.fifo` pelo AWS RedrivePolicy.

---

## 6. Modelagem Financeira e Ledger Imutável

- **Precisão Decimal Estrita**:
  - Value Object `Money` baseado na biblioteca `decimal.js`, com escala fixa de 2 casas decimais e validação de moeda (`assertSameCurrency`).
- **Ledger Imutável (*Append-Only*)**:
  - Toda movimentação de saldo gera exatamente 1 lançamento em `wallet_ledger_entries`.
  - Operações sem efeito financeiro (`LOSS` ou transações `REJECTED`) **não produzem lançamentos contábeis**.
  - A factory `WalletLedgerEntry.create` valida a invariante aritmética:
    $$\text{balanceBefore} \pm \text{amount} = \text{balanceAfter}$$
- **Reconciliação (`POST /wallets/:walletId/reconciliation`)**:
  - Recalcula o saldo a partir do zero lendo todo o histórico contábil do ledger e compara com o saldo materializado da carteira, reportando divergências de forma auditável.

---

## 7. Taxonomia de Erros e Códigos de Falha (`FailureCode`)

| FailureCode | Significado de Negócio | Ação do Provedor |
|---|---|---|
| `INSUFFICIENT_FUNDS` | Saldo da carteira menor que o valor da aposta `BET`. | Não reenviar (informar jogador). |
| `WALLET_NOT_FOUND` | Identificador de carteira inexistente. | Corrigir payload. |
| `REFERENCE_NOT_FOUND` | `REFUND` ou `ROLLBACK` referenciou transação inexistente. | Reenviar após verificar ordem. |
| `REFERENCE_ALREADY_REVERTED` | A transação referenciada já foi revertida anteriormente. | Não reenviar (já estornado). |
| `INVALID_REFERENCE_ROUND` | A transação referenciada pertence a outra rodada ou jogo. | Rejeição definitiva. |
| `CURRENCY_MISMATCH` | Moeda da aposta diverge da moeda da carteira. | Corrigir moeda do payload. |
| `ROLLBACK_WOULD_CAUSE_NEGATIVE_BALANCE` | Estorno de ganho (`WIN`) deixaria saldo negativo. | Rejeição auditável explícita. |

---

## 8. Observabilidade e Auditoria

- **Structured JSON Logging**: Implementado com Pino (`CustomLoggerModule`).
- **Tracing Context**: Injeção e propagação de `correlationId` em todas as requisições HTTP e mensagens de mensageria.
- **Sanitização de Dados Sensíveis**: Campos monetários (`money`, `balance`) e de segurança (`authorization`, `cookie`) mascarados com `[REDACTED]`.
- **Health Checks**:
  - `GET /health/live`: Liveness probe do processo.
  - `GET /health/ready`: Readiness probe verificando conexões ativas com o PostgreSQL e AWS SQS.

