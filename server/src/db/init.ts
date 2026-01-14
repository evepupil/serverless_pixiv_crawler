import { createClient } from '@libsql/client';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

// 加载环境变量 (优先加载 .env.local，然后加载 .env)
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

/**
 * 移除 SQL 注释
 */
function removeComments(sql: string): string {
  // 移除单行注释 (-- ...)
  let result = sql.replace(/--.*$/gm, '');
  // 移除多行注释 (/* ... */)
  result = result.replace(/\/\*[\s\S]*?\*\//g, '');
  return result;
}

/**
 * 分割 SQL 语句
 */
function splitStatements(sql: string): string[] {
  // 先移除注释
  const cleanSql = removeComments(sql);

  // 按分号分割，并过滤空语句
  return cleanSql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/**
 * 数据库初始化脚本
 * 在 Turso 数据库中创建所需的表结构
 */
async function initDatabase() {
  const url = process.env.TURSO_DATABASE_URL  ;
  const authToken = process.env.TURSO_AUTH_TOKEN ;
  if (!url || !authToken) {
    console.error('错误: 缺少 TURSO_DATABASE_URL 或 TURSO_AUTH_TOKEN 环境变量');
    process.exit(1);
  }

  console.log('正在连接 Turso 数据库...');
  console.log('URL:', url.substring(0, 30) + '...');

  const client = createClient({
    url,
    authToken
  });

  try {
    // 读取 schema.sql 文件
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');

    // 分割 SQL 语句
    const statements = splitStatements(schema);

    console.log(`准备执行 ${statements.length} 条 SQL 语句...`);

    // 逐条执行 SQL 语句
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      // 显示语句类型
      const stmtType = stmt.split(/\s+/)[0].toUpperCase();
      const stmtPreview = stmt.substring(0, 60).replace(/\s+/g, ' ') + (stmt.length > 60 ? '...' : '');

      try {
        await client.execute(stmt);
        console.log(`[${i + 1}/${statements.length}] ✅ ${stmtType}: ${stmtPreview}`);
      } catch (error: any) {
        // 忽略 "already exists" 类型的错误
        if (error.message?.includes('already exists')) {
          console.log(`[${i + 1}/${statements.length}] ⏭️  跳过 (已存在): ${stmtPreview}`);
        } else {
          console.error(`[${i + 1}/${statements.length}] ❌ 失败: ${stmtPreview}`);
          console.error(`    错误: ${error.message}`);
        }
      }
    }

    console.log('\n数据库初始化完成!');

    // 验证表创建结果
    console.log('\n验证表结构...');

    const tables = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    );

    console.log('已创建的表:');
    for (const row of tables.rows) {
      console.log(`  - ${row.name}`);
    }

    // 验证索引
    const indexes = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    );

    console.log('\n已创建的索引:');
    for (const row of indexes.rows) {
      console.log(`  - ${row.name}`);
    }

  } catch (error) {
    console.error('数据库初始化失败:', error);
    process.exit(1);
  } finally {
    client.close();
  }
}

// 执行初始化
initDatabase();
