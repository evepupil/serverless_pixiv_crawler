import { type Client } from '@libsql/client';
import { DatabasePic, DownloadJob, PicTask, PixivDailyRankItem } from '../types';
import { createLibsqlClient, getSharedLibsqlClient } from './client';

type TaskType = 'illust_recommend' | 'author_recommend' | 'detail_info';
type RankingSourceType = 'ranking_daily' | 'ranking_weekly' | 'ranking_monthly';
export type PicTaskSourceType = 'unknown' | 'home' | 'illust_recommend' | 'author_recommend' | 'manual' | RankingSourceType;

export interface PicTaskUpsertOptions {
  priority?: number;
  sourceType?: PicTaskSourceType;
  sourceKey?: string;
  sourceRecentAt?: string;
}

export interface RecentPreviewWindowConfig {
  rankingDailyDays: number;
  rankingWeeklyDays: number;
  rankingMonthlyDays: number;
  homeDays: number;
  illustRecommendDays: number;
  authorRecommendDays: number;
  manualDays: number;
}

export interface RecentPreviewQuotaConfig {
  rankingDailyRatio: number;
  rankingWeeklyRatio: number;
  homeRatio: number;
  relatedRatio: number;
  manualRatio: number;
}

export interface RecentPreviewCandidate {
  pid: string;
  priority: number;
  sourceType: string;
  sourceKey?: string;
  sourceRecentAt?: string;
  popularity: number;
  view: number;
}

export interface DownloadJobInput {
  pid: string;
  jobType: 'preview' | 'full' | 'backfill';
  requestedSizes: string[];
  priority?: number;
  sourceType?: string;
  sourceKey?: string;
  maxAttempts?: number;
}

/**
 * TursoService - 鍩轰簬 @libsql/client 鐨勬暟鎹簱鏈嶅姟绫?
 *
 * 鐩告瘮 Supabase (PostgreSQL)锛屼娇鐢?SQLite 璇硶锛屽苟鏀寔 Turso 鐨?Local Read Replica
 * 鍔熻兘锛屽彲灏嗘煡璇㈠欢杩熼檷鑷冲井绉掔骇锛屾瀬澶ф彁鍗囬€掑綊鐖櫕鍘婚噸妫€鏌ョ殑閫熷害銆?
 */
export class TursoService {
  private client: Client;

  /**
   * TursoService 鏋勯€犲嚱鏁?
   * @param url Turso 鏁版嵁搴?URL (渚嬪: libsql://xxx.turso.io)
   * @param authToken Turso 璁よ瘉浠ょ墝
   * @param syncUrl 鍙€夌殑鏈湴鍚屾 URL (鐢ㄤ簬 Local Read Replica)
   */
  constructor(url?: string, authToken?: string, syncUrl?: string) {
    const dbUrl = url || process.env.TURSO_DATABASE_URL;
    const token = authToken || process.env.TURSO_AUTH_TOKEN;
    const localSyncUrl = syncUrl || process.env.TURSO_SYNC_URL;

    if (!dbUrl || !token) {
      throw new Error('Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN');
    }

    // Use shared client by default to keep one connection pool in process.
    this.client = url || authToken || syncUrl
      ? createLibsqlClient({ url: dbUrl, authToken: token, syncUrl: localSyncUrl })
      : getSharedLibsqlClient();

    if (localSyncUrl) {
      console.log('Turso 鏈湴鍓湰妯″紡宸插惎鐢紝鍚屾URL:', localSyncUrl);
    }

    console.log('Turso 瀹㈡埛绔垵濮嬪寲瀹屾垚:', {
      url: dbUrl.substring(0, 30) + '...',
      hasLocalReplica: !!localSyncUrl
    });
  }

  // ========================================
  // Pic 琛ㄦ搷浣?
  // ========================================

  /**
   * 鍒涘缓鎴栨洿鏂?Pic 璁板綍 (Upsert)
   * 浣跨敤 SQLite 鐨?ON CONFLICT(pid) DO UPDATE 璇硶
   * @param pic 鍥剧墖鏁版嵁
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

      console.log('Upsert Pic 瀹屾垚:', { pid: pic.pid });
    } catch (error) {
      console.error('Upsert Pic 澶辫触:', error);
      throw error;
    }
  }

  /**
   * 鍒涘缓 Pic 璁板綍 (鍏煎鏃ф帴鍙?
   * @param pic 鍥剧墖鏁版嵁
   */
  async createPic(pic: DatabasePic): Promise<void> {
    return this.upsertPic(pic);
  }

  /**
   * 鏍规嵁 PID 鑾峰彇 Pic 璁板綍
   * @param pid 鍥剧墖ID
   * @returns DatabasePic 鎴?null
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
      console.error('鑾峰彇 Pic 澶辫触:', error);
      return null;
    }
  }

  /**
   * 妫€鏌?PID 鏄惁宸插瓨鍦紙楂樻€ц兘鍘婚噸妫€鏌ワ級
   * 鍒╃敤 Local Read Replica 鍙疄鐜板井绉掔骇鏌ヨ
   * @param pid 鍥剧墖ID
   * @returns 鏄惁瀛樺湪
   */
  async existsPid(pid: string): Promise<boolean> {
    try {
      const result = await this.client.execute({
        sql: 'SELECT 1 FROM pic WHERE pid = ? LIMIT 1',
        args: [pid]
      });
      return result.rows.length > 0;
    } catch (error) {
      console.error('妫€鏌?PID 瀛樺湪鎬уけ璐?', error);
      return false;
    }
  }

  /**
   * 鎵归噺妫€鏌?PID 鏄惁宸插瓨鍦紙楂樻€ц兘鎵归噺鍘婚噸锛?
   * @param pids PID 鏁扮粍
   * @returns 宸插瓨鍦ㄧ殑 PID 闆嗗悎
   */
  async getExistingPids(pids: string[]): Promise<Set<string>> {
    if (pids.length === 0) return new Set();

    try {
      // SQLite 浣跨敤 IN 瀛愬彞锛屾瀯寤哄崰浣嶇
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
      console.error('鎵归噺妫€鏌?PID 澶辫触:', error);
      return new Set();
    }
  }

  /**
   * 鏇存柊 Pic 涓嬭浇淇℃伅
   * @param pid 鍥剧墖ID
   * @param path 瀛樺偍璺緞锛堜笉甯﹀煙鍚嶅墠缂€锛?
   * @param imgUrl 鍥剧墖URL
   * @param fileSize 鏂囦欢澶у皬锛堝彲閫夛級
   */
  async updatePicDownload(pid: string, path: string, imgUrl: string, fileSize?: number): Promise<void> {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

    try {
      // 鍏堟煡璇㈠綋鍓嶇殑 image_path锛屾敮鎸佸灏哄瀛樺偍锛圝SON鏁扮粍鏍煎紡锛?
      const existing = await this.client.execute({
        sql: 'SELECT image_path FROM pic WHERE pid = ?',
        args: [pid]
      });

      let newImagePath: string;
      if (existing.rows.length > 0 && existing.rows[0].image_path) {
        const currentPath = existing.rows[0].image_path as string;
        try {
          // 灏濊瘯瑙ｆ瀽涓?JSON 鏁扮粍
          const paths: string[] = JSON.parse(currentPath);
          if (!paths.includes(path)) {
            paths.push(path);
          }
          newImagePath = JSON.stringify(paths);
        } catch {
          // 鏃ф牸寮忥紙鍗曚釜璺緞锛夛紝杞崲涓烘暟缁勬牸寮?
          if (currentPath === path) {
            newImagePath = JSON.stringify([currentPath]);
          } else {
            newImagePath = JSON.stringify([currentPath, path]);
          }
        }
      } else {
        // 鏂拌褰曪紝鐩存帴鍒涘缓鏁扮粍
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

      console.log('鏇存柊 Pic 涓嬭浇淇℃伅瀹屾垚:', { pid, image_path: newImagePath });
    } catch (error) {
      console.error('鏇存柊 Pic 涓嬭浇淇℃伅澶辫触:', error);
      throw error;
    }
  }

  /**
   * 鏇存柊 Pic 璁板綍
   * @param pic 閮ㄥ垎鍥剧墖鏁版嵁 (蹇呴』鍖呭惈 pid)
   */
  async updatePic(pic: Partial<DatabasePic> & { pid: string }): Promise<void> {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const { pid, ...updateData } = pic;

    // 鍔ㄦ€佹瀯寤?SET 瀛愬彞
    const setClauses: string[] = [];
    const args: any[] = [];

    for (const [key, value] of Object.entries(updateData)) {
      if (value !== undefined) {
        setClauses.push(`${key} = ?`);
        args.push(key === 'unfit' ? (value ? 1 : 0) : value);
      }
    }

    // 娣诲姞 updated_at
    setClauses.push('updated_at = ?');
    args.push(now);

    // 娣诲姞 WHERE 鏉′欢鐨勫弬鏁?
    args.push(pid);

    try {
      await this.client.execute({
        sql: `UPDATE pic SET ${setClauses.join(', ')} WHERE pid = ?`,
        args
      });

      console.log('鏇存柊 Pic 瀹屾垚:', { pid });
    } catch (error) {
      console.error('鏇存柊 Pic 澶辫触:', error);
      throw error;
    }
  }

  /**
   * 鏈€灏忓寲鎵归噺鎻掑叆/鏇存柊 Pic (浠?pid)
   * @param pids PID 鏁扮粍
   */
  async upsertMinimalPics(pids: string[]): Promise<void> {
    const uniquePids = Array.from(new Set(pids));
    if (uniquePids.length === 0) return;

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

    try {
      // 浣跨敤浜嬪姟鎵归噺鎻掑叆
      const statements = uniquePids.map(pid => ({
        sql: `
          INSERT INTO pic (pid, tag, good, star, view, image_path, image_url, popularity, created_at, updated_at)
          VALUES (?, '', 0, 0, 0, '', '', 0, ?, ?)
          ON CONFLICT(pid) DO NOTHING
        `,
        args: [pid, now, now]
      }));

      await this.client.batch(statements);

      console.log('鎵归噺 Upsert 鏈€灏?Pic 瀹屾垚:', { count: uniquePids.length });
    } catch (error) {
      console.error('鎵归噺 Upsert 鏈€灏?Pic 澶辫触:', error);
      throw error;
    }
  }

  // ========================================
  // 缁熻鏂规硶
  // ========================================

  /**
   * 鑾峰彇鎬诲浘鐗囨暟閲?
   * @returns 鎬绘暟閲?
   */
  async getTotalPicsCount(): Promise<number> {
    try {
      const result = await this.client.execute('SELECT COUNT(*) as count FROM pic');
      return Number(result.rows[0].count) || 0;
    } catch (error) {
      console.error('鑾峰彇鎬诲浘鐗囨暟閲忓け璐?', error);
      return 0;
    }
  }

  /**
   * 鑾峰彇宸蹭笅杞藉浘鐗囨暟閲?
   * @returns 宸蹭笅杞芥暟閲?
   */
  async getDownloadedPicsCount(): Promise<number> {
    try {
      const result = await this.client.execute(
        "SELECT COUNT(*) as count FROM pic WHERE image_path IS NOT NULL AND image_path != ''"
      );
      return Number(result.rows[0].count) || 0;
    } catch (error) {
      console.error('鑾峰彇宸蹭笅杞藉浘鐗囨暟閲忓け璐?', error);
      return 0;
    }
  }

  /**
   * 鑾峰彇骞冲潎鐑害
   * @returns 骞冲潎鐑害鍊?
   */
  async getAveragePopularity(): Promise<number> {
    try {
      const result = await this.client.execute('SELECT AVG(popularity) as avg_pop FROM pic');
      const avgPop = result.rows[0].avg_pop;
      return avgPop ? Number(Number(avgPop).toFixed(4)) : 0;
    } catch (error) {
      console.error('鑾峰彇骞冲潎鐑害澶辫触:', error);
      return 0;
    }
  }

  /**
   * 鑾峰彇缁熻淇℃伅锛堟ā鎷熻鍥炬煡璇級
   * @returns 缁熻瀵硅薄
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
      console.error('鑾峰彇缁熻淇℃伅澶辫触:', error);
      return { totalPics: 0, downloadedPics: 0, avgPopularity: 0 };
    }
  }

  /**
   * 闅忔満鑾峰彇 PID 鍒楄〃
   * @param count 鏁伴噺
   * @returns PID 鏁扮粍
   */
  async getRandomPids(count: number = 10): Promise<string[]> {
    try {
      // SQLite 浣跨敤 RANDOM() 鍑芥暟
      const result = await this.client.execute({
        sql: 'SELECT pid FROM pic ORDER BY RANDOM() LIMIT ?',
        args: [count]
      });

      const pids = result.rows.map(row => row.pid as string);
      console.log(`闅忔満鑾峰彇 ${pids.length} 涓?PID`);
      return pids;
    } catch (error) {
      console.error('闅忔満鑾峰彇 PID 澶辫触:', error);
      return [];
    }
  }

  /**
   * 鏍规嵁鏍囩鑾峰彇 PID 鍒楄〃
   * @param tags 鍖呭惈鐨勬爣绛?
   * @param unsupportTags 鎺掗櫎鐨勬爣绛?
   * @param limit 鏁伴噺闄愬埗
   * @returns PID 鏁扮粍
   */
  async getPicsByTags(tags: string[], unsupportTags: string[] = [], limit: number = 6): Promise<string[]> {
    try {
      let sql = 'SELECT pid FROM pic WHERE unfit = 0';
      const args: any[] = [];

      // 娣诲姞鏍囩鍖呭惈鏉′欢
      for (const tag of tags) {
        sql += ' AND tag LIKE ?';
        args.push(`%${tag}%`);
      }

      // 娣诲姞鏍囩鎺掗櫎鏉′欢
      for (const tag of unsupportTags) {
        sql += ' AND tag NOT LIKE ?';
        args.push(`%${tag}%`);
      }

      sql += ' LIMIT ?';
      args.push(limit);

      const result = await this.client.execute({ sql, args });
      return result.rows.map(row => row.pid as string);
    } catch (error) {
      console.error('鏍规嵁鏍囩鑾峰彇 PID 澶辫触:', error);
      return [];
    }
  }

  /**
   * Select top candidates for preview ingestion.
   * Rules:
   * 1. unfit = 0
   * 2. popularity >= minPopularity
   * 3. detail info already crawled (if pic_task row exists)
   * 4. image_path is empty (not archived yet)
   */
  async getTopPreviewCandidatePids(limit: number = 120, minPopularity: number = 0): Promise<string[]> {
    const safeLimit = Math.max(1, Math.min(limit, 500));
    const safePopularity = Number.isFinite(minPopularity) ? minPopularity : 0;

    try {
      const result = await this.client.execute({
        sql: `
          SELECT p.pid
          FROM pic p
          LEFT JOIN pic_task t ON t.pid = p.pid
          WHERE p.unfit = 0
            AND COALESCE(p.popularity, 0) >= ?
            AND (t.detail_info_crawled = 1 OR t.detail_info_crawled IS NULL)
            AND (
              p.image_path IS NULL OR
              TRIM(p.image_path) = '' OR
              TRIM(p.image_path) = '[]'
            )
          ORDER BY COALESCE(p.popularity, 0) DESC, COALESCE(p.view, 0) DESC
          LIMIT ?
        `,
        args: [safePopularity, safeLimit]
      });

      return result.rows.map(row => row.pid as string);
    } catch (error) {
      console.error('鑾峰彇棰勮鍊欓€?PID 澶辫触:', error);
      return [];
    }
  }

  private now(): string {
    return new Date().toISOString().slice(0, 19).replace('T', ' ');
  }

  private normalizeSourceRecentAt(value?: string): string | null {
    if (!value) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return `${trimmed} 00:00:00`;
    }
    return trimmed;
  }

  private buildPicTaskPriorityValue(priority?: number): number {
    return Number.isFinite(priority) ? Math.max(0, Math.floor(priority as number)) : 0;
  }

  private buildRetryAt(delayMinutes: number): string {
    const delayMs = Math.max(1, delayMinutes) * 60 * 1000;
    return new Date(Date.now() + delayMs).toISOString().slice(0, 19).replace('T', ' ');
  }

  // ========================================
  // pic_task 琛ㄦ搷浣?  // ========================================

  /**
   * 鍒涘缓鎴栨洿鏂?pic_task 璁板綍
   * @param pid 鍥剧墖ID
   */
  async createOrUpdatePicTask(pid: string, options?: PicTaskUpsertOptions): Promise<void> {
    const now = this.now();
    const priority = this.buildPicTaskPriorityValue(options?.priority);
    const sourceType = options?.sourceType || 'unknown';
    const sourceKey = options?.sourceKey || null;
    const sourceRecentAt = this.normalizeSourceRecentAt(options?.sourceRecentAt);

    try {
      if (!options) {
        await this.client.execute({
          sql: `
            INSERT INTO pic_task (
              pid, illust_recommend_crawled, author_recommend_crawled, detail_info_crawled, created_at, updated_at
            )
            VALUES (?, 0, 0, 0, ?, ?)
            ON CONFLICT(pid) DO UPDATE SET updated_at = excluded.updated_at
          `,
          args: [pid, now, now]
        });
      } else {
        await this.client.execute({
          sql: `
            INSERT INTO pic_task (
              pid, illust_recommend_crawled, author_recommend_crawled, detail_info_crawled,
              priority, task_source_type, task_source_key, source_recent_at,
              created_at, updated_at
            )
            VALUES (?, 0, 0, 0, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(pid) DO UPDATE SET
              priority = CASE
                WHEN excluded.priority > COALESCE(pic_task.priority, 0) THEN excluded.priority
                ELSE COALESCE(pic_task.priority, 0)
              END,
              task_source_type = CASE
                WHEN excluded.source_recent_at IS NOT NULL
                  AND (pic_task.source_recent_at IS NULL OR excluded.source_recent_at >= pic_task.source_recent_at)
                THEN excluded.task_source_type
                ELSE COALESCE(pic_task.task_source_type, excluded.task_source_type)
              END,
              task_source_key = CASE
                WHEN excluded.source_recent_at IS NOT NULL
                  AND (pic_task.source_recent_at IS NULL OR excluded.source_recent_at >= pic_task.source_recent_at)
                THEN excluded.task_source_key
                ELSE COALESCE(pic_task.task_source_key, excluded.task_source_key)
              END,
              source_recent_at = CASE
                WHEN excluded.source_recent_at IS NOT NULL
                  AND (pic_task.source_recent_at IS NULL OR excluded.source_recent_at >= pic_task.source_recent_at)
                THEN excluded.source_recent_at
                ELSE pic_task.source_recent_at
              END,
              updated_at = excluded.updated_at
          `,
          args: [pid, priority, sourceType, sourceKey, sourceRecentAt, now, now]
        });
      }

      console.log('create/update pic_task done:', { pid, priority, sourceType, sourceRecentAt });
    } catch (error) {
      console.error('create/update pic_task failed:', error);
      throw error;
    }
  }

  async batchCreatePicTasks(pids: string[], options?: PicTaskUpsertOptions): Promise<void> {
    if (!pids || pids.length === 0) return;

    const uniquePids = Array.from(new Set(pids));
    const now = this.now();
    const priority = this.buildPicTaskPriorityValue(options?.priority);
    const sourceType = options?.sourceType || 'unknown';
    const sourceKey = options?.sourceKey || null;
    const sourceRecentAt = this.normalizeSourceRecentAt(options?.sourceRecentAt);

    try {
      const statements = uniquePids.map(pid => {
        if (!options) {
          return {
            sql: `
              INSERT INTO pic_task (
                pid, illust_recommend_crawled, author_recommend_crawled, detail_info_crawled, created_at, updated_at
              )
              VALUES (?, 0, 0, 0, ?, ?)
              ON CONFLICT(pid) DO UPDATE SET updated_at = excluded.updated_at
            `,
            args: [pid, now, now]
          };
        }

        return {
          sql: `
            INSERT INTO pic_task (
              pid, illust_recommend_crawled, author_recommend_crawled, detail_info_crawled,
              priority, task_source_type, task_source_key, source_recent_at,
              created_at, updated_at
            )
            VALUES (?, 0, 0, 0, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(pid) DO UPDATE SET
              priority = CASE
                WHEN excluded.priority > COALESCE(pic_task.priority, 0) THEN excluded.priority
                ELSE COALESCE(pic_task.priority, 0)
              END,
              task_source_type = CASE
                WHEN excluded.source_recent_at IS NOT NULL
                  AND (pic_task.source_recent_at IS NULL OR excluded.source_recent_at >= pic_task.source_recent_at)
                THEN excluded.task_source_type
                ELSE COALESCE(pic_task.task_source_type, excluded.task_source_type)
              END,
              task_source_key = CASE
                WHEN excluded.source_recent_at IS NOT NULL
                  AND (pic_task.source_recent_at IS NULL OR excluded.source_recent_at >= pic_task.source_recent_at)
                THEN excluded.task_source_key
                ELSE COALESCE(pic_task.task_source_key, excluded.task_source_key)
              END,
              source_recent_at = CASE
                WHEN excluded.source_recent_at IS NOT NULL
                  AND (pic_task.source_recent_at IS NULL OR excluded.source_recent_at >= pic_task.source_recent_at)
                THEN excluded.source_recent_at
                ELSE pic_task.source_recent_at
              END,
              updated_at = excluded.updated_at
          `,
          args: [pid, priority, sourceType, sourceKey, sourceRecentAt, now, now]
        };
      });

      await this.client.batch(statements);
      console.log('batch create pic_task done:', { count: uniquePids.length, priority, sourceType });
    } catch (error) {
      console.error('batch create pic_task failed:', error);
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

  async updateIllustRecommendStatus(pid: string, count: number = 0): Promise<void> {
    const now = this.now();

    try {
      await this.client.execute({
        sql: `
          UPDATE pic_task SET
            illust_recommend_crawled = 1,
            illust_recommend_time = ?,
            illust_recommend_count = ?,
            last_error = NULL,
            next_retry_at = NULL,
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

  async updateAuthorRecommendStatus(pid: string, count: number = 0): Promise<void> {
    const now = this.now();

    try {
      await this.client.execute({
        sql: `
          UPDATE pic_task SET
            author_recommend_crawled = 1,
            author_recommend_time = ?,
            author_recommend_count = ?,
            last_error = NULL,
            next_retry_at = NULL,
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

  async updateDetailInfoStatus(pid: string): Promise<void> {
    const now = this.now();

    try {
      await this.client.execute({
        sql: `
          UPDATE pic_task SET
            detail_info_crawled = 1,
            detail_info_time = ?,
            last_error = NULL,
            next_retry_at = NULL,
            updated_at = ?
          WHERE pid = ?
        `,
        args: [now, now, pid]
      });

      console.log('更新详情信息状态完成:', { pid });
    } catch (error) {
      console.error('更新详情信息状态失败:', error);
      throw error;
    }
  }

  async getUncompletedTasks(taskType: TaskType, limit: number = 100): Promise<string[]> {
    const columnMap = {
      'illust_recommend': 'illust_recommend_crawled',
      'author_recommend': 'author_recommend_crawled',
      'detail_info': 'detail_info_crawled'
    } as const;

    const column = columnMap[taskType];

    try {
      const result = await this.client.execute({
        sql: `
          SELECT pid
          FROM pic_task
          WHERE ${column} = 0
            AND (next_retry_at IS NULL OR next_retry_at = '' OR next_retry_at <= ?)
          ORDER BY COALESCE(priority, 0) DESC, COALESCE(source_recent_at, created_at) DESC, created_at DESC
          LIMIT ?
        `,
        args: [this.now(), limit]
      });

      return result.rows.map(row => row.pid as string);
    } catch (error) {
      console.error('获取未完成任务失败:', error);
      return [];
    }
  }

  async markTaskAttemptFailed(pid: string, errorMessage: string, delayMinutes: number = 30): Promise<void> {
    const now = this.now();
    const nextRetryAt = this.buildRetryAt(delayMinutes);

    try {
      await this.client.execute({
        sql: `
          UPDATE pic_task SET
            attempt_count = COALESCE(attempt_count, 0) + 1,
            last_error = ?,
            next_retry_at = ?,
            updated_at = ?
          WHERE pid = ?
        `,
        args: [errorMessage.slice(0, 1000), nextRetryAt, now, pid]
      });
    } catch (error) {
      console.error('mark task attempt failed error:', error);
    }
  }

  async enqueueRankingTasks(
    items: PixivDailyRankItem[],
    rankDate: string,
    type: 'daily' | 'weekly' | 'monthly'
  ): Promise<void> {
    if (!items || items.length === 0) return;

    const sourceType: RankingSourceType = `ranking_${type}`;
    const sourceRecentAt = this.normalizeSourceRecentAt(rankDate) || this.now();
    const now = this.now();

    const getPriority = (rank: number) => {
      const safeRank = Number.isFinite(rank) ? Math.max(1, Math.floor(rank)) : 999;
      const base = type === 'daily' ? 1200 : type === 'weekly' ? 900 : 700;
      return Math.max(1, base - safeRank);
    };

    try {
      const statements = items.map(item => ({
        sql: `
          INSERT INTO pic_task (
            pid, illust_recommend_crawled, author_recommend_crawled, detail_info_crawled,
            priority, task_source_type, task_source_key, source_recent_at,
            created_at, updated_at
          )
          VALUES (?, 0, 0, 0, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(pid) DO UPDATE SET
            priority = CASE
              WHEN excluded.priority > COALESCE(pic_task.priority, 0) THEN excluded.priority
              ELSE COALESCE(pic_task.priority, 0)
            END,
            task_source_type = CASE
              WHEN pic_task.source_recent_at IS NULL OR excluded.source_recent_at >= pic_task.source_recent_at
              THEN excluded.task_source_type
              ELSE pic_task.task_source_type
            END,
            task_source_key = CASE
              WHEN pic_task.source_recent_at IS NULL OR excluded.source_recent_at >= pic_task.source_recent_at
              THEN excluded.task_source_key
              ELSE pic_task.task_source_key
            END,
            source_recent_at = CASE
              WHEN pic_task.source_recent_at IS NULL OR excluded.source_recent_at >= pic_task.source_recent_at
              THEN excluded.source_recent_at
              ELSE pic_task.source_recent_at
            END,
            updated_at = excluded.updated_at
        `,
        args: [item.pid, getPriority(item.rank), sourceType, `${type}:${rankDate}`, sourceRecentAt, now, now]
      }));

      await this.client.batch(statements);
      console.log('enqueue ranking tasks done:', { type, rankDate, count: items.length });
    } catch (error) {
      console.error('enqueue ranking tasks failed:', error);
      throw error;
    }
  }

  async getRecentPreviewCandidates(
    limit: number,
    minPopularity: number,
    windowConfig: RecentPreviewWindowConfig,
    quotaConfig: RecentPreviewQuotaConfig
  ): Promise<RecentPreviewCandidate[]> {
    const safeLimit = Math.max(1, Math.min(limit, 500));
    const safePopularity = Number.isFinite(minPopularity) ? minPopularity : 0;
    const quotaBuckets = [
      {
        types: ['ranking_daily'],
        windowDays: windowConfig.rankingDailyDays,
        ratio: quotaConfig.rankingDailyRatio
      },
      {
        types: ['ranking_weekly'],
        windowDays: windowConfig.rankingWeeklyDays,
        ratio: quotaConfig.rankingWeeklyRatio
      },
      {
        types: ['home'],
        windowDays: windowConfig.homeDays,
        ratio: quotaConfig.homeRatio
      },
      {
        types: ['illust_recommend', 'author_recommend'],
        windowDays: Math.max(windowConfig.illustRecommendDays, windowConfig.authorRecommendDays),
        ratio: quotaConfig.relatedRatio
      },
      {
        types: ['manual'],
        windowDays: windowConfig.manualDays,
        ratio: quotaConfig.manualRatio
      }
    ];

    const selected = new Map<string, RecentPreviewCandidate>();
    let remaining = safeLimit;

    for (let index = 0; index < quotaBuckets.length; index += 1) {
      if (remaining <= 0) break;

      const bucket = quotaBuckets[index];
      const isLastBucket = index === quotaBuckets.length - 1;
      const plannedLimit = Math.round(safeLimit * bucket.ratio);
      const bucketLimit = isLastBucket
        ? remaining
        : Math.min(remaining, plannedLimit);
      if (bucketLimit <= 0) {
        continue;
      }

      const rows = await this.queryRecentPreviewCandidatesBySource(
        bucket.types,
        bucket.windowDays,
        bucketLimit,
        safePopularity,
        Array.from(selected.keys())
      );

      for (const row of rows) {
        if (!selected.has(row.pid)) {
          selected.set(row.pid, row);
          remaining -= 1;
          if (remaining <= 0) break;
        }
      }
    }

    if (remaining > 0) {
      const fallbackTypes = ['ranking_daily', 'ranking_weekly', 'ranking_monthly', 'home', 'illust_recommend', 'author_recommend', 'manual'];
      const fallbackWindowDays = Math.max(
        windowConfig.rankingDailyDays,
        windowConfig.rankingWeeklyDays,
        windowConfig.rankingMonthlyDays,
        windowConfig.homeDays,
        windowConfig.illustRecommendDays,
        windowConfig.authorRecommendDays,
        windowConfig.manualDays
      );

      const fallbackRows = await this.queryRecentPreviewCandidatesBySource(
        fallbackTypes,
        fallbackWindowDays,
        remaining,
        safePopularity,
        Array.from(selected.keys())
      );

      for (const row of fallbackRows) {
        if (!selected.has(row.pid)) {
          selected.set(row.pid, row);
        }
      }
    }

    return Array.from(selected.values()).slice(0, safeLimit);
  }

  private async queryRecentPreviewCandidatesBySource(
    sourceTypes: string[],
    windowDays: number,
    limit: number,
    minPopularity: number,
    excludePids: string[] = []
  ): Promise<RecentPreviewCandidate[]> {
    if (!sourceTypes.length || limit <= 0) return [];

    const safeWindowDays = Math.max(1, Math.floor(windowDays));
    const since = new Date(Date.now() - safeWindowDays * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 19)
      .replace('T', ' ');

    const sourcePlaceholders = sourceTypes.map(() => '?').join(', ');
    const args: Array<string | number> = [minPopularity, ...sourceTypes, since];
    let excludeSql = '';
    if (excludePids.length > 0) {
      excludeSql = ` AND p.pid NOT IN (${excludePids.map(() => '?').join(', ')})`;
      args.push(...excludePids);
    }

    args.push(limit);

    try {
      const result = await this.client.execute({
        sql: `
          SELECT
            p.pid,
            COALESCE(t.priority, 0) AS priority,
            COALESCE(t.task_source_type, 'unknown') AS source_type,
            t.task_source_key AS source_key,
            t.source_recent_at AS source_recent_at,
            COALESCE(p.popularity, 0) AS popularity,
            COALESCE(p.view, 0) AS view
          FROM pic p
          INNER JOIN pic_task t ON t.pid = p.pid
          WHERE p.unfit = 0
            AND COALESCE(p.popularity, 0) >= ?
            AND t.detail_info_crawled = 1
            AND COALESCE(t.task_source_type, 'unknown') IN (${sourcePlaceholders})
            AND COALESCE(t.source_recent_at, t.created_at, p.updated_at, p.created_at) >= ?
            AND (
              p.image_path IS NULL OR
              TRIM(p.image_path) = '' OR
              TRIM(p.image_path) = '[]'
            )
            AND NOT EXISTS (
              SELECT 1
              FROM download_job j
              WHERE j.pid = p.pid
                AND j.job_type = 'preview'
                AND j.status IN ('pending', 'running', 'success')
            )
            ${excludeSql}
          ORDER BY
            COALESCE(t.priority, 0) DESC,
            COALESCE(p.popularity, 0) DESC,
            COALESCE(p.view, 0) DESC,
            COALESCE(t.source_recent_at, t.created_at) DESC
          LIMIT ?
        `,
        args
      });

      return result.rows.map(row => ({
        pid: row.pid as string,
        priority: Number(row.priority) || 0,
        sourceType: row.source_type as string,
        sourceKey: row.source_key as string | undefined,
        sourceRecentAt: row.source_recent_at as string | undefined,
        popularity: Number(row.popularity) || 0,
        view: Number(row.view) || 0
      }));
    } catch (error) {
      console.error('query recent preview candidates failed:', error);
      return [];
    }
  }

  async enqueueDownloadJobs(jobs: DownloadJobInput[]): Promise<number> {
    if (!jobs.length) return 0;
    const now = this.now();
    let inserted = 0;

    for (const job of jobs) {
      const existing = await this.client.execute({
        sql: `
          SELECT id
          FROM download_job
          WHERE pid = ?
            AND job_type = ?
            AND status IN ('pending', 'running', 'success')
          LIMIT 1
        `,
        args: [job.pid, job.jobType]
      });

      if (existing.rows.length > 0) {
        continue;
      }

      await this.client.execute({
        sql: `
          INSERT INTO download_job (
            pid, job_type, requested_sizes, status, priority,
            source_type, source_key, max_attempts, attempt_count,
            created_at, updated_at
          )
          VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, 0, ?, ?)
        `,
        args: [
          job.pid,
          job.jobType,
          JSON.stringify(job.requestedSizes),
          this.buildPicTaskPriorityValue(job.priority),
          job.sourceType || null,
          job.sourceKey || null,
          Number.isFinite(job.maxAttempts) ? Math.max(1, Math.floor(job.maxAttempts as number)) : 3,
          now,
          now
        ]
      });
      inserted += 1;
    }

    return inserted;
  }

  async claimPendingDownloadJobs(jobType: 'preview' | 'full' | 'backfill', limit: number): Promise<DownloadJob[]> {
    const safeLimit = Math.max(1, Math.min(limit, 500));
    const now = this.now();

    try {
      const result = await this.client.execute({
        sql: `
          SELECT *
          FROM download_job
          WHERE job_type = ?
            AND status = 'pending'
            AND COALESCE(attempt_count, 0) < COALESCE(max_attempts, 3)
          ORDER BY COALESCE(priority, 0) DESC, created_at ASC
          LIMIT ?
        `,
        args: [jobType, safeLimit]
      });

      const jobs = result.rows.map(row => this.rowToDownloadJob(row));
      if (jobs.length === 0) {
        return [];
      }

      await this.client.batch(
        jobs.map(job => ({
          sql: `
            UPDATE download_job
            SET status = 'running',
                started_at = COALESCE(started_at, ?),
                updated_at = ?
            WHERE id = ?
          `,
          args: [now, now, job.id]
        }))
      );

      return jobs.map(job => ({
        ...job,
        status: 'running',
        started_at: job.started_at || now,
        updated_at: now
      }));
    } catch (error) {
      console.error('claim pending download jobs failed:', error);
      return [];
    }
  }

  async markDownloadJobSuccess(id: number): Promise<void> {
    const now = this.now();
    await this.client.execute({
      sql: `
        UPDATE download_job
        SET status = 'success',
            finished_at = ?,
            updated_at = ?,
            last_error = NULL
        WHERE id = ?
      `,
      args: [now, now, id]
    });
  }

  async markDownloadJobFailed(id: number, errorMessage: string): Promise<void> {
    const now = this.now();
    await this.client.execute({
      sql: `
        UPDATE download_job
        SET status = 'failed',
            attempt_count = COALESCE(attempt_count, 0) + 1,
            finished_at = ?,
            updated_at = ?,
            last_error = ?
        WHERE id = ?
      `,
      args: [now, now, errorMessage.slice(0, 1000), id]
    });
  }
  async upsertRankings(
    items: PixivDailyRankItem[],
    rankDate: string,
    type: 'daily' | 'weekly' | 'monthly'
  ): Promise<void> {
    if (!items || items.length === 0) {
      console.log('鎺掕姒滄暟鎹负绌猴紝璺宠繃鍐欏叆');
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

      console.log('鎺掕姒滃啓鍏ュ畬鎴?', { type, rankDate, count: items.length });
    } catch (error) {
      console.error('鎺掕姒滃啓鍏ュけ璐?', error);
      throw error;
    }
  }

  // ========================================
  // 杈呭姪鏂规硶
  // ========================================

  /**
   * 灏嗘暟鎹簱琛岃浆鎹负 DatabasePic 瀵硅薄
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
   * 灏嗘暟鎹簱琛岃浆鎹负 PicTask 瀵硅薄
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
      priority: row.priority ? Number(row.priority) : 0,
      task_source_type: row.task_source_type as string | undefined,
      task_source_key: row.task_source_key as string | undefined,
      source_recent_at: row.source_recent_at as string | undefined,
      attempt_count: row.attempt_count ? Number(row.attempt_count) : 0,
      next_retry_at: row.next_retry_at as string | undefined,
      last_error: row.last_error as string | undefined,
      created_at: row.created_at as string | undefined,
      updated_at: row.updated_at as string | undefined
    };
  }

  private rowToDownloadJob(row: any): DownloadJob {
    let requestedSizes: string[] = [];
    try {
      const parsed = JSON.parse(String(row.requested_sizes || '[]'));
      if (Array.isArray(parsed)) {
        requestedSizes = parsed.map(item => String(item)).filter(Boolean);
      }
    } catch {
      requestedSizes = [];
    }

    return {
      id: Number(row.id),
      pid: row.pid as string,
      job_type: (row.job_type as DownloadJob['job_type']) || 'preview',
      requested_sizes: requestedSizes,
      status: (row.status as DownloadJob['status']) || 'pending',
      priority: row.priority ? Number(row.priority) : 0,
      source_type: row.source_type as string | undefined,
      source_key: row.source_key as string | undefined,
      max_attempts: row.max_attempts ? Number(row.max_attempts) : 3,
      attempt_count: row.attempt_count ? Number(row.attempt_count) : 0,
      last_error: row.last_error as string | undefined,
      started_at: row.started_at as string | undefined,
      finished_at: row.finished_at as string | undefined,
      created_at: row.created_at as string | undefined,
      updated_at: row.updated_at as string | undefined
    };
  }

  /**
   * 鍚屾鏈湴鍓湰 (鐢ㄤ簬 Local Read Replica 妯″紡)
   * 鍦ㄤ笢浜湇鍔″櫒涓婂畾鏈熻皟鐢ㄤ互淇濇寔鏁版嵁鍚屾
   */
  async sync(): Promise<void> {
    try {
      // @libsql/client 浼氳嚜鍔ㄥ鐞嗗悓姝ワ紝杩欓噷鍙槸鏄惧紡瑙﹀彂
      console.log('瑙﹀彂 Turso 鏈湴鍓湰鍚屾...');
      // 鎵ц涓€涓交閲忔煡璇㈡潵瑙﹀彂鍚屾
      await this.client.execute('SELECT 1');
      console.log('Turso sync complete');
    } catch (error) {
      console.error('Turso 鍚屾澶辫触:', error);
    }
  }

  /**
   * 鍏抽棴鏁版嵁搴撹繛鎺?
   */
  async close(): Promise<void> {
    this.client.close();
    console.log('Turso connection closed');
  }
}
