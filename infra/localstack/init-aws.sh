#!/usr/bin/env bash
set -euo pipefail

echo "==> Inicializando filas SQS no LocalStack..."

# 1. Fila de Dead Letter (DLQ) FIFO
awslocal sqs create-queue \
  --queue-name wager-transactions-dlq.fifo \
  --attributes FifoQueue=true,ContentBasedDeduplication=true

# Obtem o ARN da DLQ
DLQ_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/wager-transactions-dlq.fifo \
  --attribute-names QueueArn \
  --query 'Attributes.QueueArn' \
  --output text)

echo "DLQ Criada: $DLQ_ARN"

# Cria a fila principal
awslocal sqs create-queue \
  --queue-name wager-transactions.fifo \
  --attributes FifoQueue=true,ContentBasedDeduplication=true

QUEUE_URL=$(awslocal sqs get-queue-url --queue-name wager-transactions.fifo --query 'QueueUrl' --output text)

# Seta a RedrivePolicy separadamente para evitar problemas de escape de aspas
awslocal sqs set-queue-attributes \
  --queue-url "$QUEUE_URL" \
  --attributes "{\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"$DLQ_ARN\\\",\\\"maxReceiveCount\\\":\\\"5\\\"}\"}"

echo "==> Filas criadas e associadas à DLQ com sucesso!"
