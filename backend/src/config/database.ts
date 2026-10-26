import mongoose from 'mongoose';
import { getEnv } from './environment.js';
import { logger } from '../utils/logger.js';

mongoose.set('strictQuery', true);

/** Connects to MongoDB and builds the indexes declared on every model. Fails loudly: there is no fake-data fallback. */
export async function connectDatabase(uri = getEnv().MONGODB_URI): Promise<typeof mongoose> {
  const connection = await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, autoIndex: false });
  await mongoose.connection.syncIndexes();
  logger.info('MongoDB connected', { database: connection.connection.name });
  return connection;
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}

let transactionSupport: boolean | undefined;

/** Transactions need a replica set or sharded cluster (Atlas always qualifies). */
export async function supportsTransactions(): Promise<boolean> {
  if (transactionSupport !== undefined) return transactionSupport;
  const db = mongoose.connection.db;
  if (!db) return false;
  const hello = await db.admin().command({ hello: 1 });
  transactionSupport = Boolean(hello.setName || hello.msg === 'isdbgrid');
  return transactionSupport;
}
