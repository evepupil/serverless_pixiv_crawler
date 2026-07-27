import path from 'path';
import fs from 'fs';
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

/**
 * 判断是否为本地文件模式（file: 开头）。
 * 本地文件模式不需要 authToken，也不需要 syncUrl（文件本身就是主库）。
 */
export function isFileUrl(url?: string): boolean {
  return Boolean(url && url.toLowerCase().startsWith('file:'));
}

/**
 * 把 file: URL 解析成磁盘路径，并确保其父目录存在（libsql 不会自动建目录，否则报 SQLITE_CANTOPEN）。
 */
function ensureLocalFileDir(url: string): void {
  const withoutScheme = url.slice('file:'.length);
  let fsPath: string;
  if (withoutScheme.startsWith('//')) {
    // file://host/path 或 file:///abs/path：去掉两斜杠，保留绝对路径
    const after = withoutScheme.slice(2);
    fsPath = after.startsWith('/') ? after : `/${after}`;
  } else if (withoutScheme.startsWith('/')) {
    fsPath = withoutScheme;
  } else {
    fsPath = withoutScheme; // 相对路径
  }
  const parent = path.dirname(fsPath);
  if (parent && parent !== '.' && parent !== '/') {
    fs.mkdirSync(parent, { recursive: true });
  }
}

/**
 * 对本地文件连接应用一组常用 pragma：WAL 提升并发写入，synchronous=NORMAL 兼顾安全与速度，
 * busy_timeout 避免偶发锁冲突直接报错，foreign_keys 开启外键约束。
 * WAL 模式写入文件头后会持久化；其余 pragma 是 per-connection，每次新建连接都要设置。
 */
function applyLocalPragmas(client: Client): void {
  // 这些 pragma 是异步的，但服务进程启动后通常 10s 才跑第一个真实查询，
  // 这里 fire-and-forget 即可覆盖到；即便个别查询抢先跑，最坏只是首条查询慢一点。
  void Promise.all([
    client.execute('PRAGMA journal_mode=WAL'),
    client.execute('PRAGMA synchronous=NORMAL'),
    client.execute('PRAGMA busy_timeout=5000'),
    client.execute('PRAGMA foreign_keys=ON')
  ]).catch(error => {
    console.error('应用本地 SQLite pragma 失败:', error);
  });
}

export function createLibsqlClient(options: TursoConnectionOptions = {}): Client {
  const url = options.url || process.env.TURSO_DATABASE_URL;
  const authToken = options.authToken || process.env.TURSO_AUTH_TOKEN;
  const syncUrl = options.syncUrl || process.env.TURSO_SYNC_URL;

  if (!url) {
    throw new Error('Missing env var: TURSO_DATABASE_URL');
  }

  const usingFile = isFileUrl(url);

  // 远程 libsql/http 才需要鉴权；本地 file: 模式不需要 token
  if (!usingFile && !authToken) {
    throw new Error('Missing TURSO_AUTH_TOKEN for remote libsql URL');
  }

  const clientConfig: Parameters<typeof createClient>[0] = { url };
  if (!usingFile && authToken) {
    clientConfig.authToken = authToken;
  }
  // syncUrl 只对远程嵌入式副本（Local Read Replica）有意义；本地 file 模式忽略
  if (!usingFile && syncUrl) {
    clientConfig.syncUrl = syncUrl;
  }

  if (usingFile) {
    ensureLocalFileDir(url);
  }

  const client = createClient(clientConfig);

  if (usingFile) {
    applyLocalPragmas(client);
  }

  return client;
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
