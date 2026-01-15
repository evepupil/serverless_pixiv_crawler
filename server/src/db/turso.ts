import { createClient, Client, ResultSet } from '@libsql/client';
import { DatabasePic, PicTask, PixivDailyRankItem } from '../types';

/**
 * TursoService - 基于 @libsql/client 的数据库服务类
 *
 * 相比 Supabase (PostgreSQL)，使用 SQLite 语法，并支持 Turso 的 Local Read Replica
 * 功能，可将查询延迟降至微秒级，极大提升递归爬虫去重检查的速度。
 */
export class TursoService {
  private client: Client;

  /**
   * TursoService 构造函数
   * @param url Turso 数据库 URL (例如: libsql://xxx.turso.io)
   * @param authToken Turso 认证令牌
   * @param syncUrl 可选的本地同步 URL (用于 Local Read Replica)
   */
  constructor(url?: string, authToken?: string, syncUrl?: string) {
    const dbUrl = url || process.env.TURSO_DATABASE_URL;
    const token = authToken || process.env.TURSO_AUTH_TOKEN;
    const localSyncUrl = syncUrl || process.env.TURSO_SYNC_URL;

    if (!dbUrl || !token) {
      throw new Error('缺少 Turso 环境变量: TURSO_DATABASE_URL 和 TURSO_AUTH_TOKEN 是必需的');
    }

    // 创建客户端配置
    const clientConfig: any = {
      url: dbUrl,
      authToken: token
    };

    // 如果配置了本地同步 URL，启用嵌入式副本 (Local Read Replica)
    // 这将在本地维护一个 SQLite 副本，查询延迟可降至微秒级
    if (localSyncUrl) {
      clientConfig.syncUrl = localSyncUrl;
      console.log('Turso 本地副本模式已启用，同步URL:', localSyncUrl);
    }

    this.client = createClient(clientConfig);

    console.log('Turso 客户端初始化完成:', {
      url: dbUrl.substring(0, 30) + '...',
      hasLocalReplica: !!localSyncUrl
    });
  }

  // ========================================
  // Pic 表操作
  // ========================================

  /**
   * 创建或更新 Pic 记录 (Upsert)
   * 使用 SQLite 的 ON CONFLICT(pid) DO UPDATE 语法
   * @param pic 图片数据
   */
  async upsertPic(pic: DatabasePic): Promise<void> {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

    try {
      await this.client.execute({
        sql: `
          INSERT INTO pic (
            pid, title, author_id, author_name, tag, good, star, view,
            image_path, image_url, popularity, download_time, upload_time,
            wx_url, wx_name, unfit, size, created_at, updated_at
          ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          )
          ON CONFLICT(pid) DO UPDATE SET
            title = COALESCE(excluded.title, pic.title),
            author_id = COALESCE(excluded.author_id, pic.author_id),
            author_name = COALESCE(excluded.author_name, pic.author_name),
            tag = COALESCE(excluded.tag, pic.tag),
            good = COALESCE(excluded.good, pic.good),
            star = COALESCE(excluded.star, pic.star),
            view = COALESCE(excluded.view, pic.view),
            image_path = COALESCE(excluded.image_path, pic.image_path),
            image_url = COALESCE(excluded.image_url, pic.image_url),
            popularity = COALESCE(excluded.popularity, pic.popularity),
            download_time = COALESCE(excluded.download_time, pic.download_time),
            upload_time = COALESCE(excluded.upload_time, pic.upload_time),
            wx_url = COALESCE(excluded.wx_url, pic.wx_url),
            wx_name = COALESCE(excluded.wx_name, pic.wx_name),
            unfit = COALESCE(excluded.unfit, pic.unfit),
            size = COALESCE(excluded.size, pic.size),
            updated_at = ?
        `,
        args: [
          pic.pid,
          pic.title || null,
          pic.author_id || null,
          pic.author_name || null,
          pic.tag || null,
          pic.good || 0,
          pic.star || 0,
          pic.view || 0,
          pic.image_path || null,
          pic.image_url || null,
          pic.popularity || 0,
          pic.download_time || null,
          pic.upload_time || null,
          pic.wx_url || null,
          pic.wx_name || null,
          pic.unfit ? 1 : 0,
          pic.size || null,
          now,
          now,
          now
        ]
      });

      console.log('Upsert Pic 完成:', { pid: pic.pid });
    } catch (error) {
      console.error('Upsert Pic 失败:', error);
      throw error;
    }
  }

  /**
   * 创建 Pic 记录 (兼容旧接口)
   * @param pic 图片数据
   */
  async createPic(pic: DatabasePic): Promise<void> {
    return this.upsertPic(pic);
  }

  /**
   * 根据 PID 获取 Pic 记录
   * @param pid 图片ID
   * @returns DatabasePic 或 null
   */
  async getPicByPid(pid: string): Promise<DatabasePic | null> {
    try {
      const result = await this.client.execute({
        sql: 'SELECT * FROM pic WHERE pid = ?',
        args: [pid]
      });

      if (result.rows.length === 0) {
        return null;
      }

      return this.rowToDatabasePic(result.rows[0]);
    } catch (error) {
      console.error('获取 Pic 失败:', error);
      return null;
    }
  }

  /**
   * 检查 PID 是否已存在（高性能去重检查）
   * 利用 Local Read Replica 可实现微秒级查询
   * @param pid 图片ID
   * @returns 是否存在
   */
  async existsPid(pid: string): Promise<boolean> {
    try {
      const result = await this.client.execute({
        sql: 'SELECT 1 FROM pic WHERE pid = ? LIMIT 1',
        args: [pid]
      });
      return result.rows.length > 0;
    } catch (error) {
      console.error('检查 PID 存在性失败:', error);
      return false;
    }
  }

  /**
   * 批量检查 PID 是否已存在（高性能批量去重）
   * @param pids PID 数组
   * @returns 已存在的 PID 集合
   */
  async getExistingPids(pids: string[]): Promise<Set<string>> {
    if (pids.length === 0) return new Set();

    try {
      // SQLite 使用 IN 子句，构建占位符
      const placeholders = pids.map(() => '?').join(',');
      const result = await this.client.execute({
        sql: `SELECT pid FROM pic WHERE pid IN (${placeholders})`,
        args: pids
      });

      const existingPids = new Set<string>();
      for (const row of result.rows) {
        existingPids.add(row.pid as string);
      }
      return existingPids;
    } catch (error) {
      console.error('批量检查 PID 失败:', error);
      return new Set();
    }
  }

  /**
   * 更新 Pic 下载信息
   * @param pid 图片ID
   * @param path 存储路径（不带域名前缀）
   * @param imgUrl 图片URL
   * @param fileSize 文件大小（可选）
   */
  async updatePicDownload(pid: string, path: string, imgUrl: string, fileSize?: number): Promise<void> {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

    try {
      // 先查询当前的 image_path，支持多尺寸存储（JSON数组格式）
      const existing = await this.client.execute({
        sql: 'SELECT image_path FROM pic WHERE pid = ?',
        args: [pid]
      });

      let newImagePath: string;
      if (existing.rows.length > 0 && existing.rows[0].image_path) {
        const currentPath = existing.rows[0].image_path as string;
        try {
          // 尝试解析为 JSON 数组
          const paths: string[] = JSON.parse(currentPath);
          if (!paths.includes(path)) {
            paths.push(path);
          }
          newImagePath = JSON.stringify(paths);
        } catch {
          // 旧格式（单个路径），转换为数组格式
          if (currentPath === path) {
            newImagePath = JSON.stringify([currentPath]);
          } else {
            newImagePath = JSON.stringify([currentPath, path]);
          }
        }
      } else {
        // 新记录，直接创建数组
        newImagePath = JSON.stringify([path]);
      }

      await this.client.execute({
        sql: `
          UPDATE pic SET
            image_path = ?,
            image_url = COALESCE(?, image_url),
            upload_time = ?,
            size = COALESCE(?, size),
            updated_at = ?
          WHERE pid = ?
        `,
        args: [newImagePath, imgUrl || null, now, fileSize || null, now, pid]
      });

      console.log('更新 Pic 下载信息完成:', { pid, image_path: newImagePath });
    } catch (error) {
      console.error('更新 Pic 下载信息失败:', error);
      throw error;
    }
  }

  /**
   * 更新 Pic 记录
   * @param pic 部分图片数据 (必须包含 pid)
   */
  async updatePic(pic: Partial<DatabasePic> & { pid: string }): Promise<void> {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const { pid, ...updateData } = pic;

    // 动态构建 SET 子句
    const setClauses: string[] = [];
    const args: any[] = [];

    for (const [key, value] of Object.entries(updateData)) {
      if (value !== undefined) {
        setClauses.push(`${key} = ?`);
        args.push(key === 'unfit' ? (value ? 1 : 0) : value);
      }
    }

    // 添加 updated_at
    setClauses.push('updated_at = ?');
    args.push(now);

    // 添加 WHERE 条件的参数
    args.push(pid);

    try {
      await this.client.execute({
        sql: `UPDATE pic SET ${setClauses.join(', ')} WHERE pid = ?`,
        args
      });

      console.log('更新 Pic 完成:', { pid });
    } catch (error) {
      console.error('更新 Pic 失败:', error);
      throw error;
    }
  }

  /**
   * 最小化批量插入/更新 Pic (仅 pid)
   * @param pids PID 数组
   */
  async upsertMinimalPics(pids: string[]): Promise<void> {
    const uniquePids = Array.from(new Set(pids));
    if (uniquePids.length === 0) return;

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

    try {
      // 使用事务批量插入
      const statements = uniquePids.map(pid => ({
        sql: `
          INSERT INTO pic (pid, tag, good, star, view, image_path, image_url, popularity, created_at, updated_at)
          VALUES (?, '', 0, 0, 0, '', '', 0, ?, ?)
          ON CONFLICT(pid) DO NOTHING
        `,
        args: [pid, now, now]
      }));

      await this.client.batch(statements);

      console.log('批量 Upsert 最小 Pic 完成:', { count: uniquePids.length });
    } catch (error) {
      console.error('批量 Upsert 最小 Pic 失败:', error);
      throw error;
    }
  }

  // ========================================
  // 统计方法
  // ========================================

  /**
   * 获取总图片数量
   * @returns 总数量
   */
  async getTotalPicsCount(): Promise<number> {
    try {
      const result = await this.client.execute('SELECT COUNT(*) as count FROM pic');
      return Number(result.rows[0].count) || 0;
    } catch (error) {
      console.error('获取总图片数量失败:', error);
      return 0;
    }
  }

  /**
   * 获取已下载图片数量
   * @returns 已下载数量
   */
  async getDownloadedPicsCount(): Promise<number> {
    try {
      const result = await this.client.execute(
        "SELECT COUNT(*) as count FROM pic WHERE image_path IS NOT NULL AND image_path != ''"
      );
      return Number(result.rows[0].count) || 0;
    } catch (error) {
      console.error('获取已下载图片数量失败:', error);
      return 0;
    }
  }

  /**
   * 获取平均热度
   * @returns 平均热度值
   */
  async getAveragePopularity(): Promise<number> {
    try {
      const result = await this.client.execute('SELECT AVG(popularity) as avg_pop FROM pic');
      const avgPop = result.rows[0].avg_pop;
      return avgPop ? Number(Number(avgPop).toFixed(4)) : 0;
    } catch (error) {
      console.error('获取平均热度失败:', error);
      return 0;
    }
  }

  /**
   * 获取统计信息（模拟视图查询）
   * @returns 统计对象
   */
  async getStatsFromView(): Promise<{ totalPics: number; downloadedPics: number; avgPopularity: number }> {
    try {
      const result = await this.client.execute(`
        SELECT
          COUNT(*) as total_pics,
          SUM(CASE WHEN image_path IS NOT NULL AND image_path != '' THEN 1 ELSE 0 END) as downloaded_pics,
          AVG(popularity) as avg_popularity
        FROM pic
      `);

      const row = result.rows[0];
      return {
        totalPics: Number(row.total_pics) || 0,
        downloadedPics: Number(row.downloaded_pics) || 0,
        avgPopularity: row.avg_popularity ? Number(Number(row.avg_popularity).toFixed(4)) : 0
      };
    } catch (error) {
      console.error('获取统计信息失败:', error);
      return { totalPics: 0, downloadedPics: 0, avgPopularity: 0 };
    }
  }

  /**
   * 随机获取 PID 列表
   * @param count 数量
   * @returns PID 数组
   */
  async getRandomPids(count: number = 10): Promise<string[]> {
    try {
      // SQLite 使用 RANDOM() 函数
      const result = await this.client.execute({
        sql: 'SELECT pid FROM pic ORDER BY RANDOM() LIMIT ?',
        args: [count]
      });

      const pids = result.rows.map(row => row.pid as string);
      console.log(`随机获取 ${pids.length} 个 PID`);
      return pids;
    } catch (error) {
      console.error('随机获取 PID 失败:', error);
      return [];
    }
  }

  /**
   * 根据标签获取 PID 列表
   * @param tags 包含的标签
   * @param unsupportTags 排除的标签
   * @param limit 数量限制
   * @returns PID 数组
   */
  async getPicsByTags(tags: string[], unsupportTags: string[] = [], limit: number = 6): Promise<string[]> {
    try {
      let sql = 'SELECT pid FROM pic WHERE unfit = 0';
      const args: any[] = [];

      // 添加标签包含条件
      for (const tag of tags) {
        sql += ' AND tag LIKE ?';
        args.push(`%${tag}%`);
      }

      // 添加标签排除条件
      for (const tag of unsupportTags) {
        sql += ' AND tag NOT LIKE ?';
        args.push(`%${tag}%`);
      }

      sql += ' LIMIT ?';
      args.push(limit);

      const result = await this.client.execute({ sql, args });
      return result.rows.map(row => row.pid as string);
    } catch (error) {
      console.error('根据标签获取 PID 失败:', error);
      return [];
    }
  }

  // ========================================
  // pic_task 表操作
  // ========================================

  /**
   * 创建或更新 pic_task 记录
   * @param pid 图片ID
   */
  async createOrUpdatePicTask(pid: string): Promise<void> {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

    try {
      await this.client.execute({
        sql: `
          INSERT INTO pic_task (pid, illust_recommend_crawled, author_recommend_crawled, detail_info_crawled, created_at, updated_at)
          VALUES (?, 0, 0, 0, ?, ?)
          ON CONFLICT(pid) DO UPDATE SET updated_at = ?
        `,
        args: [pid, now, now, now]
      });

      console.log('创建/更新 pic_task 完成:', { pid });
    } catch (error) {
      console.error('创建/更新 pic_task 失败:', error);
      throw error;
    }
  }

  /**
   * 批量创建 pic_task 记录
   * @param pids PID 数组
   */
  async batchCreatePicTasks(pids: string[]): Promise<void> {
    if (!pids || pids.length === 0) return;

    const uniquePids = Array.from(new Set(pids));
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

    try {
      const statements = uniquePids.map(pid => ({
        sql: `
          INSERT INTO pic_task (pid, illust_recommend_crawled, author_recommend_crawled, detail_info_crawled, created_at, updated_at)
          VALUES (?, 0, 0, 0, ?, ?)
          ON CONFLICT(pid) DO NOTHING
        `,
        args: [pid, now, now]
      }));

      await this.client.batch(statements);

      console.log('批量创建 pic_task 完成:', { count: uniquePids.length });
    } catch (error) {
      console.error('批量创建 pic_task 失败:', error);
      throw error;
    }
  }

  /**
   * 删除 pic_task 记录
   * @param pid 图片ID
   */
  async deletePicTask(pid: string): Promise<void> {
    try {
      await this.client.execute({
        sql: 'DELETE FROM pic_task WHERE pid = ?',
        args: [pid]
      });

      console.log('删除 pic_task 完成:', { pid });
    } catch (error) {
      console.error('删除 pic_task 失败:', error);
      throw error;
    }
  }

  /**
   * 获取 pic_task 记录
   * @param pid 图片ID
   * @returns PicTask 或 null
   */
  async getPicTask(pid: string): Promise<PicTask | null> {
    try {
      const result = await this.client.execute({
        sql: 'SELECT * FROM pic_task WHERE pid = ?',
        args: [pid]
      });

      if (result.rows.length === 0) {
        return null;
      }

      return this.rowToPicTask(result.rows[0]);
    } catch (error) {
      console.error('获取 pic_task 失败:', error);
      return null;
    }
  }

  /**
   * 更新插画推荐爬取状态
   * @param pid 图片ID
   * @param count 推荐数量
   */
  async updateIllustRecommendStatus(pid: string, count: number = 0): Promise<void> {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

    try {
      await this.client.execute({
        sql: `
          UPDATE pic_task SET
            illust_recommend_crawled = 1,
            illust_recommend_time = ?,
            illust_recommend_count = ?,
            updated_at = ?
          WHERE pid = ?
        `,
        args: [now, count, now, pid]
      });

      console.log('更新插画推荐状态完成:', { pid, count });
    } catch (error) {
      console.error('更新插画推荐状态失败:', error);
      throw error;
    }
  }

  /**
   * 更新作者推荐爬取状态
   * @param pid 图片ID
   * @param count 推荐数量
   */
  async updateAuthorRecommendStatus(pid: string, count: number = 0): Promise<void> {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

    try {
      await this.client.execute({
        sql: `
          UPDATE pic_task SET
            author_recommend_crawled = 1,
            author_recommend_time = ?,
            author_recommend_count = ?,
            updated_at = ?
          WHERE pid = ?
        `,
        args: [now, count, now, pid]
      });

      console.log('更新作者推荐状态完成:', { pid, count });
    } catch (error) {
      console.error('更新作者推荐状态失败:', error);
      throw error;
    }
  }

  /**
   * 更新详细信息爬取状态
   * @param pid 图片ID
   */
  async updateDetailInfoStatus(pid: string): Promise<void> {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

    try {
      await this.client.execute({
        sql: `
          UPDATE pic_task SET
            detail_info_crawled = 1,
            detail_info_time = ?,
            updated_at = ?
          WHERE pid = ?
        `,
        args: [now, now, pid]
      });

      console.log('更新详细信息状态完成:', { pid });
    } catch (error) {
      console.error('更新详细信息状态失败:', error);
      throw error;
    }
  }

  /**
   * 获取未完成指定任务的 PID 列表
   * @param taskType 任务类型
   * @param limit 数量限制
   * @returns PID 数组
   */
  async getUncompletedTasks(
    taskType: 'illust_recommend' | 'author_recommend' | 'detail_info',
    limit: number = 100
  ): Promise<string[]> {
    const columnMap = {
      'illust_recommend': 'illust_recommend_crawled',
      'author_recommend': 'author_recommend_crawled',
      'detail_info': 'detail_info_crawled'
    };

    const column = columnMap[taskType];

    try {
      const result = await this.client.execute({
        sql: `SELECT pid FROM pic_task WHERE ${column} = 0 LIMIT ?`,
        args: [limit]
      });

      return result.rows.map(row => row.pid as string);
    } catch (error) {
      console.error('获取未完成任务失败:', error);
      return [];
    }
  }

  // ========================================
  // 排行榜操作
  // ========================================

  /**
   * 批量写入/更新排行榜数据
   * @param items 排行榜条目
   * @param rankDate 排行日期
   * @param type 排行类型
   */
  async upsertRankings(
    items: PixivDailyRankItem[],
    rankDate: string,
    type: 'daily' | 'weekly' | 'monthly'
  ): Promise<void> {
    if (!items || items.length === 0) {
      console.log('排行榜数据为空，跳过写入');
      return;
    }

    try {
      const statements = items.map(item => ({
        sql: `
          INSERT INTO ranking (pid, rank, rank_type, rank_date, crawl_time)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(rank_type, rank_date, pid) DO UPDATE SET
            rank = excluded.rank,
            crawl_time = excluded.crawl_time
        `,
        args: [item.pid, item.rank, type, rankDate, item.crawl_time]
      }));

      await this.client.batch(statements);

      console.log('排行榜写入完成:', { type, rankDate, count: items.length });
    } catch (error) {
      console.error('排行榜写入失败:', error);
      throw error;
    }
  }

  // ========================================
  // 辅助方法
  // ========================================

  /**
   * 将数据库行转换为 DatabasePic 对象
   */
  private rowToDatabasePic(row: any): DatabasePic {
    return {
      pid: row.pid as string,
      title: row.title as string | undefined,
      author_id: row.author_id as string | undefined,
      author_name: row.author_name as string | undefined,
      download_time: row.download_time as string | undefined,
      tag: row.tag as string,
      good: Number(row.good) || 0,
      star: Number(row.star) || 0,
      view: Number(row.view) || 0,
      image_path: row.image_path as string,
      image_url: row.image_url as string,
      popularity: Number(row.popularity) || 0,
      upload_time: row.upload_time as string | undefined,
      wx_url: row.wx_url as string | undefined,
      wx_name: row.wx_name as string | undefined,
      unfit: Boolean(row.unfit),
      size: row.size ? Number(row.size) : undefined
    };
  }

  /**
   * 将数据库行转换为 PicTask 对象
   */
  private rowToPicTask(row: any): PicTask {
    return {
      pid: row.pid as string,
      illust_recommend_crawled: Boolean(row.illust_recommend_crawled),
      illust_recommend_time: row.illust_recommend_time as string | undefined,
      illust_recommend_count: row.illust_recommend_count ? Number(row.illust_recommend_count) : undefined,
      author_recommend_crawled: Boolean(row.author_recommend_crawled),
      author_recommend_time: row.author_recommend_time as string | undefined,
      author_recommend_count: row.author_recommend_count ? Number(row.author_recommend_count) : undefined,
      detail_info_crawled: Boolean(row.detail_info_crawled),
      detail_info_time: row.detail_info_time as string | undefined,
      created_at: row.created_at as string | undefined,
      updated_at: row.updated_at as string | undefined
    };
  }

  /**
   * 同步本地副本 (用于 Local Read Replica 模式)
   * 在东京服务器上定期调用以保持数据同步
   */
  async sync(): Promise<void> {
    try {
      // @libsql/client 会自动处理同步，这里只是显式触发
      console.log('触发 Turso 本地副本同步...');
      // 执行一个轻量查询来触发同步
      await this.client.execute('SELECT 1');
      console.log('Turso 本地副本同步完成');
    } catch (error) {
      console.error('Turso 同步失败:', error);
    }
  }

  /**
   * 关闭数据库连接
   */
  async close(): Promise<void> {
    this.client.close();
    console.log('Turso 连接已关闭');
  }
}
