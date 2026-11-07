# Jungle Gaming — Backend Challenge: Distributed Wagering Processor

Processador transacional financeiro distribuído de alta concorrência construído com **Bun**, **TypeScript**, **NestJS 12**, **PostgreSQL 16**, **MikroORM 6** e **AWS SQS** (via LocalStack).

Seguindo os padrões de **Domain-Driven Design (DDD)** e **Arquitetura Hexagonal (Ports & Adapters)**, o sistema garante correção monetária estrita com escala fixa de 2 casas decimais, ledger imutável (*append-only*), concorrência serializada por *pessimistic locking* exclusivo de carteira, idempotência persistente via canonical payload hash (SHA-256) e mensageria atômica via Transactional Outbox e Inbox Pattern.

---

## 🚀 Requisitos e Pré-requisitos

- [Bun](https://bun.sh/) 1.1 ou superior (Runtime, package manager e test runner oficial)
- [Docker](https://www.docker.com/) e Docker Compose
- Porta `5433` livre para o PostgreSQL do container
- Porta `4566` livre para o LocalStack (AWS SQS)
- Porta `3000` livre para o servidor NestJS

---

## ⚙️ Setup do Ambiente e Dependências

### 1. Instalação das dependências

```bash
bun install
```

### 2. Subir os serviços de infraestrutura (PostgreSQL e LocalStack)

```bash
docker compose up -d postgres localstack
```

> **Nota de Porta:** O container PostgreSQL foi mapeado para a porta **`5433`** (`5433:5432`) para evitar conflito com instâncias locais do PostgreSQL instaladas no host.

### 3. Criar as filas SQS no LocalStack

As filas FIFO necessárias para o processador e para a Dead Letter Queue (DLQ) com RedrivePolicy de 5 tentativas podem ser criadas com:

```bash
# Criar a fila DLQ
docker exec -i challenge_localstack awslocal sqs create-queue \
  --queue-name wager-transactions-dlq.fifo \
  --attributes FifoQueue=true,ContentBasedDeduplication=false

# Criar a fila principal com RedrivePolicy
docker exec -i challenge_localstack awslocal sqs create-queue \
  --queue-name wager-transactions.fifo \
  --attributes "FifoQueue=true,ContentBasedDeduplication=false,RedrivePolicy={\"deadLetterTargetArn\":\"arn:aws:sqs:us-east-1:000000000000:wager-transactions-dlq.fifo\",\"maxReceiveCount\":5}"
```

### 4. Executar as Migrations do Banco de Dados

O projeto utiliza migrations versionadas gerenciadas pelo **MikroORM**:

```bash
bun run migration:up
```

Para reverter migrations caso necessário:
```bash
bun run migration:down
```

---

## 🏃‍♂️ Executando a Aplicação

### Modo Desenvolvimento (Watch mode)
```bash
bun run start:dev
```

### Compilar o projeto
```bash
bun run build
```

### Modo Produção
```bash
bun run start:prod
```

### Executar tudo via Docker Compose
Para subir o banco, o localstack e a aplicação containerizada:
```bash
docker compose up -d --build
```

---

## 🧪 Executando os Testes

O projeto conta com cobertura completa usando **`bun:test`**, abrangendo testes unitários de domínio e testes de integração/concorrência com banco e mensageria reais.

```bash
# Executa todos os testes unitários (Money, Wallet, WagerTransaction, Ledger, Outbox)
bun test

# Executa os testes de concorrência financeira extrema (cenário R$ 100 vs R$ 80, 50 apostas simultâneas)
bun run test:concurrency

# Executa todos os testes de ponta a ponta (SQS LocalStack + PostgreSQL real + Concorrência)
bun run test:e2e

# Executa testes em modo watch
bun run test:watch
```

---

## 📡 Endpoints da API HTTP

### 1. Health Checks (Liveness & Readiness)
- `GET /health/live` — Verifica se o processo está vivo.
- `GET /health/ready` — Verifica se o PostgreSQL e o LocalStack SQS estão alcançáveis e respondendo.

### 2. Gerenciamento de Carteiras (`/wallets`)
- `POST /wallets` — Abre uma nova carteira para o jogador com saldo inicial atômico (`OPENING` no ledger).
  ```json
  {
    "playerId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
    "initialBalance": { "amount": "1000.00", "currency": "BRL" }
  }
  ```
- `GET /wallets/:walletId` — Retorna saldo atual e versão da carteira.
- `GET /wallets/:walletId/ledger?cursor=...&limit=50` — Consulta lançamentos contábeis paginados por cursor opaco base64.
- `POST /wallets/:walletId/reconciliation` — Audita e reconcilia o saldo armazenado contra todo o histórico do ledger.

### 3. Processamento de Transações (`/wagering`)
- `POST /wagering/transactions` — Submete uma transação (`BET`, `WIN`, `LOSS`, `REFUND`, `ROLLBACK`).
  - **Header Obrigatório:** `Idempotency-Key: provider-a:transaction-123`
  ```json
  {
    "providerId": "provider-a",
    "externalTransactionId": "transaction-123",
    "playerId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
    "walletId": "0192f291-27dd-7d3f-8071-5f8685deef37",
    "roundId": "round-987",
    "gameId": "fortune-chimp",
    "kind": "BET",
    "money": { "amount": "25.00", "currency": "BRL" }
  }
  ```
- `GET /wagering/transactions/:transactionId` — Consulta transação pelo ID interno.
- `GET /providers/:providerId/wagering/transactions/:externalTransactionId` — Consulta transação pelo ID externo do provedor.

---

## 📨 Processamento Assíncrono via SQS

A aplicação também consome operações via SQS FIFO (`wager-transactions.fifo`) reutilizando o mesmo caso de uso:

```json
{
  "messageId": "msg-123",
  "type": "WagerTransactionRequested",
  "occurredAt": "2026-07-29T15:00:00.000Z",
  "data": {
    "providerId": "provider-a",
    "externalTransactionId": "transaction-123",
    "idempotencyKey": "provider-a:transaction-123",
    "playerId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
    "walletId": "0192f291-27dd-7d3f-8071-5f8685deef37",
    "roundId": "round-987",
    "gameId": "fortune-chimp",
    "kind": "BET",
    "money": { "amount": "25.00", "currency": "BRL" }
  }
}
```

O consumidor assegura:
1. **Deduplicação via Inbox persistente** por `(consumerName, messageId)`.
2. **Ack (deleteMessage) apenas pós-commit** da transação SQL.
3. **Dead Letter Queue (DLQ)** após 5 falhas consecutivas.

---

## 📑 Documentação Técnica

Para detalhes completos sobre:
- Decisões de modelagem DDD (Agregados, Entidades e Value Objects)
- Estratégia de concorrência com pessimistic locking
- Idempotência com Hash canônico
- Padrões Transactional Outbox com `FOR UPDATE SKIP LOCKED` e Inbox Pattern
- Taxonomia de `FailureCode`

Consulte o arquivo [`ARCHITECTURE.md`](./ARCHITECTURE.md).
