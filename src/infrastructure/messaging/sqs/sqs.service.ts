import { Injectable, Logger } from '@nestjs/common';
import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
  GetQueueAttributesCommand,
  type Message,
} from '@aws-sdk/client-sqs';

@Injectable()
export class SqsService {
  private readonly logger = new Logger(SqsService.name);
  private readonly sqsClient: SQSClient;
  public readonly wagerQueueUrl: string;
  public readonly dlqUrl: string;

  constructor() {
    const endpoint = process.env.AWS_ENDPOINT || 'http://localhost:4566';
    const region = process.env.AWS_REGION || 'us-east-1';

    this.sqsClient = new SQSClient({
      endpoint,
      region,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
      },
    });

    this.wagerQueueUrl =
      process.env.SQS_WAGER_QUEUE_URL ||
      'http://localhost:4566/000000000000/wager-transactions.fifo';

    this.dlqUrl =
      process.env.SQS_DLQ_URL ||
      'http://localhost:4566/000000000000/wager-transactions-dlq.fifo';
  }

  getClient(): SQSClient {
    return this.sqsClient;
  }

  /**
   * Envia uma mensagem para a fila FIFO
   */
  async sendMessage(params: {
    queueUrl?: string;
    messageBody: string;
    messageGroupId: string;
    messageDeduplicationId: string;
  }): Promise<string | undefined> {
    const command = new SendMessageCommand({
      QueueUrl: params.queueUrl || this.wagerQueueUrl,
      MessageBody: params.messageBody,
      MessageGroupId: params.messageGroupId,
      MessageDeduplicationId: params.messageDeduplicationId,
    });

    const response = await this.sqsClient.send(command);
    return response.MessageId;
  }

  /**
   * Recebe mensagens com long-polling
   */
  async receiveMessages(params?: {
    queueUrl?: string;
    maxNumberOfMessages?: number;
    waitTimeSeconds?: number;
    visibilityTimeout?: number;
  }): Promise<Message[]> {
    const command = new ReceiveMessageCommand({
      QueueUrl: params?.queueUrl || this.wagerQueueUrl,
      MaxNumberOfMessages: params?.maxNumberOfMessages ?? 10,
      WaitTimeSeconds: params?.waitTimeSeconds ?? 20,
      VisibilityTimeout: params?.visibilityTimeout ?? 30,
      AttributeNames: ['All'],
      MessageAttributeNames: ['All'],
    });

    const response = await this.sqsClient.send(command);
    return response.Messages || [];
  }

  /**
   * Deleta mensagem (Ack após commit)
   */
  async deleteMessage(receiptHandle: string, queueUrl?: string): Promise<void> {
    const command = new DeleteMessageCommand({
      QueueUrl: queueUrl || this.wagerQueueUrl,
      ReceiptHandle: receiptHandle,
    });

    await this.sqsClient.send(command);
  }

  /**
   * Altera a visibilidade da mensagem (ex: devolver imediatamente se erro transitório)
   */
  async changeVisibility(receiptHandle: string, visibilityTimeout = 0, queueUrl?: string): Promise<void> {
    const command = new ChangeMessageVisibilityCommand({
      QueueUrl: queueUrl || this.wagerQueueUrl,
      ReceiptHandle: receiptHandle,
      VisibilityTimeout: visibilityTimeout,
    });

    await this.sqsClient.send(command);
  }

  /**
   * Health check do SQS
   */
  async checkHealth(): Promise<boolean> {
    try {
      const command = new GetQueueAttributesCommand({
        QueueUrl: this.wagerQueueUrl,
        AttributeNames: ['ApproximateNumberOfMessages'],
      });
      await this.sqsClient.send(command);
      return true;
    } catch (err: any) {
      this.logger.error(`SQS Health Check failed: ${err.message}`);
      return false;
    }
  }
}

