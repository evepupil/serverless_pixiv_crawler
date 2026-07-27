import type { Client, InValue } from '@libsql/client';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 通用表复制工具：把一个 libsql 客户端里的表数据 upsert 到另一个客户端。
 * 一次性迁移（云端 -> 本地文件）和定时备份（本地文件 -> 云端）都复用它。
 */

export interface CopyTableSpec {
  name: string;
  /** 唯一约束的列，作为 ON CONFLICT 目标。 */
  conflictCols: string[];
  /** 用于增量同步的时间戳列（有则按 >= since 过滤，没有则全量）。 */
  timestampColumn?: string;
}

/** 爬虫全部业务表及其唯一键。download_job 没有自然唯一键，用 id 保证云端 id 与本地一致。 */
export const CRAWLER_TABLES: CopyTableSpec[] = [
  { name: 'pic', conflictCols: ['pid'], timestampColumn: 'updated_at' },
  { name: 'pic_task', conflictCols: ['pid'], timestampColumn: 'updated_at' },
  { name: 'pic_source', conflictCols: ['pid', 'source_type', 'source_key'], timestampColumn: 'updated_at' },
  { name: 'watch_target', conflictCols: ['target_type', 'target_value', 'biz_type'], timestampColumn: 'updated_at' },
  { name: 'ranking', conflictCols: ['rank_type', 'rank_date', 'pid'], timestampColumn: 'crawl_time' },
  { name: 'download_job', conflictCols: ['id'], timestampColumn: 'updated_at' }
];

export interface CopyTableResult {
  table: string;
  copied: number;
  durationMs: number;
}

export interface CopyTablesOptions {
  /** 增量起点（含），格式 'YYYY-MM-DD HH:MM:SS'；不传则全量复制。 */
  since?: string;
  /** 单次读取/写入行数。 */
  batchSize?: number;
  /** 复制完前几张表就停，调试用。 */
  tables?: CopyTableSpec[];
}

/**
 * 把 src 的数据 upsert 到 dst。用 rowid 分页避免 OFFSET 在大表上的 O(N^2) 扫描。
 * 注意：upsert 不会同步删除操作——本地删掉的行在 dst 仍会保留，冷备场景可接受。
 */
export async function copyTables(
  src: Client,
  dst: Client,
  options: CopyTablesOptions = {}
): Promise<CopyTableResult[]> {
  const batchSize = options.batchSize ?? 500;
  const tables = options.tables ?? CRAWLER_TABLES;
  const results: CopyTableResult[] = [];

  for (const table of tables) {
    const startedAt = Date.now();
    let copied = 0;
    let lastRowid = 0;

    while (true) {
      const conditions = ['rowid > ?'];
      const args: Array<string | number> = [lastRowid];
      if (table.timestampColumn && options.since) {
        conditions.push(`${table.timestampColumn} >= ?`);
        args.push(options.since);
      }
      args.push(batchSize);

      // SELECT *, rowid AS __rowid：rowid 用于分页游标，__rowid 不参与写入
      const result = await src.execute({
        sql: `SELECT *, rowid AS __rowid FROM ${table.name} WHERE ${conditions.join(' AND ')} ORDER BY rowid LIMIT ?`,
        args
      });

      if (result.rows.length === 0) {
        break;
      }

      const cols = (result.columns ?? []).filter(col => col !== '__rowid');
      if (cols.length === 0) {
        break;
      }

      const conflictTarget = table.conflictCols.join(', ');
      const updateCols = cols.filter(col => !table.conflictCols.includes(col));
      const setClause = updateCols.length > 0
        ? `DO UPDATE SET ${updateCols.map(col => `${col} = excluded.${col}`).join(', ')}`
        : 'DO NOTHING';
      const sql = `INSERT INTO ${table.name} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) ON CONFLICT(${conflictTarget}) ${setClause}`;

      const statements = result.rows.map(row => {
        const rowRecord = row as Record<string, unknown>;
        const args: InValue[] = cols.map(col => {
          const value = rowRecord[col];
          // libsql 对 undefined 不友好，统一转 null
          return value === undefined ? null : (value as InValue);
        });
        return { sql, args };
      });

      await dst.batch(statements);
      copied += result.rows.length;

      const lastRow = result.rows[result.rows.length - 1] as Record<string, unknown>;
      lastRowid = Number(lastRow.__rowid) || lastRowid + result.rows.length;

      if (result.rows.length < batchSize) {
        break;
      }
    }

    const durationMs = Date.now() - startedAt;
    console.log(`[copy] ${table.name}: ${copied} 行, ${durationMs}ms${options.since ? ` (since=${options.since})` : ''}`);
    results.push({ table: table.name, copied, durationMs });
  }

  return results;
}

/** 读取一张表的总行数，用于迁移前预估。 */
export async function countRows(client: Client, tableName: string): Promise<number> {
  const result = await client.execute({ sql: `SELECT COUNT(*) AS c FROM ${tableName}`, args: [] });
  const row = result.rows[0] as Record<string, unknown> | undefined;
  return Number(row?.c ?? 0);
}

function splitSqlStatements(sql: string): string[] {
  const noComments = sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  return noComments
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/**
 * 在目标库上应用 schema.sql（CREATE TABLE IF NOT EXISTS，幂等）。
 * 备份目标是已有云端 Turso 时也是 no-op；新建空库时负责建表。
 * 找不到 schema.sql 时跳过并提示（假设目标库已有结构）。
 */
export async function ensureSchema(client: Client): Promise<void> {
  const candidates = [
    path.resolve(process.cwd(), 'src/db/schema.sql'),
    path.resolve(__dirname, '../db/schema.sql')
  ];
  const schemaPath = candidates.find(p => fs.existsSync(p));
  if (!schemaPath) {
    console.warn('[schema] 未找到 schema.sql，假设目标库已有表结构');
    return;
  }
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  const statements = splitSqlStatements(schema);
  for (const stmt of statements) {
    try {
      await client.execute(stmt);
    } catch (error: any) {
      if (error.message?.includes('already exists')) {
        continue;
      }
      throw error;
    }
  }
  console.log(`[schema] 已在目标库应用 schema.sql（${statements.length} 条语句）`);
}
