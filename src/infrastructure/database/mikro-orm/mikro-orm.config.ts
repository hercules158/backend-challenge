import { defineConfig, PostgreSqlDriver } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import { WalletOrmEntity } from './entities/wallet.orm-entity.js';
import { LedgerEntryOrmEntity } from './entities/ledger-entry.orm-entity.js';
import { WagerTransactionOrmEntity } from './entities/wager-transaction.orm-entity.js';
import { InboxMessageOrmEntity } from './entities/inbox-message.orm-entity.js';
import { OutboxMessageOrmEntity } from './entities/outbox-message.orm-entity.js';

export default defineConfig({
  driver: PostgreSqlDriver,
  clientUrl: process.env.DATABASE_URL || 'postgresql://challenge:challenge_secret@localhost:5433/wagering_db',
  allowGlobalContext: true,
  entities: [
    WalletOrmEntity,
    LedgerEntryOrmEntity,
    WagerTransactionOrmEntity,
    InboxMessageOrmEntity,
    OutboxMessageOrmEntity,
  ],
  extensions: [Migrator],
  migrations: {
    path: './src/infrastructure/database/mikro-orm/migrations',
    pathTs: './src/infrastructure/database/mikro-orm/migrations',
    glob: '!(*.d).{js,ts}',
    transactional: true,
    allOrNothing: true,
    emit: 'ts',
  },
  debug: process.env.NODE_ENV !== 'production',
});
