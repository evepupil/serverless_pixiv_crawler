import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import { createClient, type Client } from '@libsql/client';
import { isFileUrl } from '../db/client';
import { CRAWLER_TABLES, copyTables, countRows, ensureSchema } from './db-copy';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

/**
 * 一次性迁移脚本：把云端 Turso 的全量数据导出到本地 SQLite 文件。
 *
 * 使用方式（在 server/ 目录下，确保 .env.local 里仍是云端 Turso 的 URL+TOKEN）：
 *   npx ts-node src/scripts/export-cloud-to-local.ts [本地文件路径]
 *
 * 默认输出到 ./data/pixiv.db。脚本会自动建表 + 全量复制，可重复执行（upsert） */

async function main() {
  const cloudUrl = process.env.TURSO_DATABASE_URL;
  const cloudToken = process.env.TURSO_AUTH_TOKEN;
  const localPath = path.resolve(process.cwd(), process.argv[2] || process.env.LOCAL_DB_PATH || './data/pixiv.db');

  if (!cloudUrl) {
    console.error('缺少 TURSO_DATABASE_URL，无法从云端导出');
    process.exit(1);
  }
  if (isFileUrl(cloudUrl)) {
    console.error('TURSO_DATABASE_URL 当前是本地 file: 地址。导出脚本需要云端 libsql:// 地址，请先在 .env.local 里填回云端 Turso 的 URL+TOKEN。');
    process.exit(1);
  }
  if (!cloudToken) {
    console.error('缺少 TURSO_AUTH_TOKEN，无法连接云端 Turso');
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(localPath), { recursive: true });

  const cloudClient = createClient({ url: cloudUrl, authToken: cloudToken });
  // Windows 路径反斜杠在 file: URL 里会出问题，统一成正斜杠
  const localFileUrl = `file:${localPath.replace(/\\/g, '/')}`;
  const localClient = createClient({ url: localFileUrl });

  console.log('源（云端 Turso）:', cloudUrl.substring(0, 40) + '...');
  console.log('目标（本地文件）:', localPath);

  // 先确认源表行数
  console.log('\n源表行数预估:');
  for (const table of CRAWLER_TABLES) {
    const count = await countRows(cloudClient, table.name);
    console.log(`  ${table.name}: ${count}`);
  }

  console.log('\n在本地文件上建表...');
  await ensureSchema(localClient);

  console.log('\n开始全量复制...');
  const results = await copyTables(cloudClient, localClient, { batchSize: 500 });

  const total = results.reduce((sum, r) => sum + r.copied, 0);
  console.log(`\n迁移完成，共 ${total} 行:`);
  for (const r of results) {
    console.log(`  ${r.table}: ${r.copied}`);
  }

  cloudClient.close();
  localClient.close();
}

main().catch(error => {
  console.error('迁移失败:', error);
  process.exit(1);
});
