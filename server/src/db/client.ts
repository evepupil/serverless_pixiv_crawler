import path from 'path';
import dotenv from 'dotenv';
import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { schema } from './schema';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

export interface TursoConnectionOptions {
  url?: string;
  authToken?: string;
  syncUrl?: string;
}

let sharedClient: Client | null = null;
let sharedDrizzleDb: LibSQLDatabase<typeof schema> | null = null;

export function createLibsqlClient(options: TursoConnectionOptions = {}): Client {
  const url = options.url || process.env.TURSO_DATABASE_URL;
  const authToken = options.authToken || process.env.TURSO_AUTH_TOKEN;
  const syncUrl = options.syncUrl || process.env.TURSO_SYNC_URL;

  if (!url || !authToken) {
    throw new Error('Missing Turso env vars: TURSO_DATABASE_URL and TURSO_AUTH_TOKEN');
  }

  const clientConfig: Parameters<typeof createClient>[0] = {
    url,
    authToken
  };

  if (syncUrl) {
    clientConfig.syncUrl = syncUrl;
  }

  return createClient(clientConfig);
}

export function getSharedLibsqlClient(): Client {
  if (!sharedClient) {
    sharedClient = createLibsqlClient();
  }
  return sharedClient;
}

export function getDrizzleDb(): LibSQLDatabase<typeof schema> {
  if (!sharedDrizzleDb) {
    sharedDrizzleDb = drizzle(getSharedLibsqlClient(), { schema });
  }
  return sharedDrizzleDb;
}

export type CrawlerDb = LibSQLDatabase<typeof schema>;

