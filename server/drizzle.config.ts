import path from 'path';
import dotenv from 'dotenv';
import { defineConfig } from 'drizzle-kit';
import { isFileUrl } from './src/db/client';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
const usingFile = isFileUrl(url);

if (!url) {
  throw new Error('Missing TURSO_DATABASE_URL for Drizzle config');
}
// 本地 file: 模式不需要 token。
// 注意：drizzle-kit 的 turso 方言对 file: URL 的支持有限，本地建表优先用 `npm run db:init`（init.ts 跑 schema.sql）。
if (!usingFile && !authToken) {
  throw new Error('Missing TURSO_AUTH_TOKEN for remote Drizzle config');
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'turso',
  dbCredentials: {
    url,
    authToken
  },
  verbose: true,
  strict: true
});

