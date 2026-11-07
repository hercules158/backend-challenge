import { Migration } from '@mikro-orm/migrations';

export class Migration20261107120717 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "inbox_messages" ("id" uuid not null, "message_id" varchar(255) not null, "consumer_name" varchar(100) not null, "payload_hash" varchar(64) not null, "received_at" timestamptz not null, "processed_at" timestamptz null, constraint "inbox_messages_pkey" primary key ("id"));`);
    this.addSql(`alter table "inbox_messages" add constraint "uq_inbox_consumer_message" unique ("consumer_name", "message_id");`);

    this.addSql(`create table "wallet_ledger_entries" ("id" uuid not null, "wallet_id" uuid not null, "transaction_id" uuid not null, "direction" varchar(10) not null, "money_amount" numeric(18,2) not null, "currency" varchar(3) not null, "balance_before_amount" numeric(18,2) not null, "balance_after_amount" numeric(18,2) not null, "created_at" timestamptz not null, constraint "wallet_ledger_entries_pkey" primary key ("id"), constraint chk_ledger_money_positive check (money_amount > 0));`);
    this.addSql(`create index "idx_ledger_wallet_created" on "wallet_ledger_entries" ("wallet_id", "created_at");`);

    this.addSql(`create table "outbox_messages" ("id" uuid not null, "aggregate_id" uuid not null, "event_type" varchar(100) not null, "payload" jsonb not null, "occurred_at" timestamptz not null, "attempts" int not null default 0, "next_attempt_at" timestamptz null, "published_at" timestamptz null, constraint "outbox_messages_pkey" primary key ("id"));`);
    this.addSql(`create index "idx_outbox_pending_due" on "outbox_messages" ("published_at", "next_attempt_at");`);

    this.addSql(`create table "wager_transactions" ("id" uuid not null, "provider_id" varchar(100) not null, "external_transaction_id" varchar(255) not null, "idempotency_key" varchar(350) not null, "payload_hash" varchar(64) not null, "wallet_id" uuid not null, "player_id" uuid not null, "round_id" varchar(100) not null, "game_id" varchar(100) not null, "kind" varchar(20) not null, "money_amount" numeric(18,2) not null, "currency" varchar(3) not null, "reference_external_transaction_id" varchar(255) null, "reference_transaction_id" uuid null, "status" varchar(30) not null, "failure_code" varchar(50) null, "created_at" timestamptz not null, "processed_at" timestamptz null, constraint "wager_transactions_pkey" primary key ("id"));`);
    this.addSql(`create index "idx_wager_tx_wallet_created" on "wager_transactions" ("wallet_id", "created_at");`);
    this.addSql(`alter table "wager_transactions" add constraint "uq_wager_tx_provider_external" unique ("provider_id", "external_transaction_id");`);
    this.addSql(`alter table "wager_transactions" add constraint "uq_wager_tx_idempotency_key" unique ("idempotency_key");`);

    this.addSql(`create table "wallets" ("id" uuid not null, "player_id" uuid not null, "currency" varchar(3) not null, "balance_amount" numeric(18,2) not null, "version" int not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "wallets_pkey" primary key ("id"), constraint chk_wallets_balance_non_negative check (balance_amount >= 0));`);
    this.addSql(`alter table "wallets" add constraint "uq_wallets_player_currency" unique ("player_id", "currency");`);
  }

}
