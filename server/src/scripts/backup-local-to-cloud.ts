import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import { createClient, type Client } from '@libsql/client';
import { isFileUrl } from '../db/client';
import { CRAWLER_TABLES, copyTables, ensureSchema } from './db-copy';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

/**
 * 定时备份脚本：把本地 SQLite 文件增量 upsert 到云端 Turso（冷备）。
 *
 * 增量策略：按各表的 updated_at（ranking 用 crawl_time）>= 上次备份时间 过滤；
 * 首次运行（无状态文件）走全量。状态文件记录在 BACKUP_STATE_PATH（默认 data/.backup-state.json）。
 *
 * 运行方式（在 server/ 目录下）：
 *   开发：npx ts-node src/scripts/backup-local-to-cloud.ts
 *   生产：npm run build && node dist/scripts/backup-local-to-cloud.js
 *
 * 建议用系统 cron 或 PM2 定时跑，例如每天一次：
 *   0 4 * * * cd /path/to/server && node dist/scripts/backup-local-to-cloud.js >> logs/backup.log 2>&1
 *
 * 注意：upsert 不会同步删除，本地删掉的行在云端仍保留，冷备场景可接受。
 */

function nowString(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

interface BackupState {
  lastBackupAt: string;
}

function readState(statePath: string): string | undefined {
  if (!fs.existsSync(statePath)) {
    return undefined;
  }
  try {
    const raw = fs.readFileSync(statePath, 'utf-8');
    const parsed = JSON.parse(raw) as BackupState;
    return parsed.lastBackupAt;
  } catch {
    return undefined;
  }
}

function writeState(statePath: string, lastBackupAt: string): void {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify({ lastBackupAt } as BackupState, null, 2));
}

async function main() {
  const localUrl = process.env.TURSO_DATABASE_URL;
  const backupUrl = process.env.TURSO_BACKUP_URL || process.env.TURSO_BACKUP_DATABASE_URL;
  const backupToken = process.env.TURSO_BACKUP_AUTH_TOKEN || process.env.TURSO_BACKUP_TOKEN;
  const statePath = path.resolve(process.cwd(), process.env.BACKUP_STATE_PATH || './data/.backup-state.json');

  if (!localUrl || !isFileUrl(localUrl)) {
    console.error('TURSO_DATABASE_URL 必须是本地 file: 地址（本地为主模式）');
    process.exit(1);
  }
  if (!backupUrl || !backupToken) {
    console.error('缺少备份目标环境变量，需要: TURSO_BACKUP_URL 和 TURSO_BACKUP_AUTH_TOKEN');
    process.exit(1);
  }

  const localClient = createClient({ url: localUrl });
  const cloudClient = createClient({ url: backupUrl, authToken: backupToken });

  const runStartedAt = nowString();
  const since = readState(statePath);

  console.log(`[backup] 开始，本地文件 -> 云端 Turso`);
  console.log(`  本地: ${localUrl}`);
  console.log(`  云端: ${backupUrl.substring(0, 40)}...`);
  console.log(`  增量起点: ${since || '（无，全量）'}`);
  console.log(`  本次运行时间: ${runStartedAt}`);

  // 确保云端备份目标有表结构（已有则 no-op，新建空库则建表）
  await ensureSchema(cloudClient);

  const results = await copyTables(localClient, cloudClient, { since, batchSize: 500 });

  const total = results.reduce((sum, r) => sum + r.copied, 0);
  console.log(`[backup] 完成，共 ${total} 行:`);
  for (const r of results) {
    console.log(`  ${r.table}: ${r.copied}`);
  }

  // 用「本次运行开始时间」作为下次的增量起点，保证运行期间更新的行不会丢
  writeState(statePath, runStartedAt);
  console.log(`[backup] 已更新增量起点 -> ${runStartedAt} (${statePath})`);

  localClient.close();
  cloudClient.close();
}

main().catch(error => {
  console.error('[backup] 备份失败:', error);
  process.exit(1);
});
