import { Entity, PrimaryKey, Property, Unique } from '@mikro-orm/core';

@Entity({ tableName: 'inbox_messages' })
@Unique({ properties: ['consumerName', 'messageId'], name: 'uq_inbox_consumer_message' })
export class InboxMessageOrmEntity {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ type: 'varchar', length: 255 })
  messageId!: string;

  @Property({ type: 'varchar', length: 100 })
  consumerName!: string;

  @Property({ type: 'varchar', length: 64 })
  payloadHash!: string;

  @Property({ type: 'timestamptz' })
  receivedAt: Date = new Date();

  @Property({ type: 'timestamptz', nullable: true })
  processedAt?: Date;
}

