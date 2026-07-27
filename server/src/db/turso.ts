import { type Client } from '@libsql/client';
import { DatabasePic, DownloadJob, PicTask, PixivDailyRankItem, WatchTarget } from '../types';
import { createLibsqlClient, getSharedLibsqlClient, isFileUrl } from './client';
import {
  buildImageVariants as buildImageVariantMap,
  parseImagePathValue,
  type PixivImageSize
} from '../proxy/storage-path';

type TaskType = 'illust_recommend' | 'author_recommend' | 'detail_info';
type RankingSourceType = 'ranking_daily' | 'ranking_weekly' | 'ranking_monthly';
export type WatchTargetType = 'tag' | 'artist';
export type WatchSourceType = 'tag_watch' | 'artist_watch';
export type PicTaskSourceType =
  | 'unknown'
  | 'home'
  | 'illust_recommend'
  | 'author_recommend'
  | 'manual'
  | WatchSourceType
  | RankingSourceType;
export type PicSourceType = Exclude<PicTaskSourceType, 'unknown'>;

export interface PicTaskUpsertOptions {
  priority?: number;
  sourceType?: PicTaskSourceType;
  sourceKey?: string;
  sourceRecentAt?: string;
}

export interface PicSourceUpsertInput {
  pid: string;
  sourceType: PicSourceType;
  sourceKey: string;
  discoveredAt?: string;
  bizType?: string;
  rankValue?: number;
  sourceScore?: number;
  meta?: string;
}

export interface RecentPreviewWindowConfig {
  rankingDailyDays: number;
  rankingWeeklyDays: number;
  rankingMonthlyDays: number;
  homeDays: number;
  illustRecommendDays: number;
  authorRecommendDays: number;
  tagWatchDays: number;
  artistWatchDays: number;
  manualDays: number;
}

export interface RecentPreviewQuotaConfig {
  rankingDailyRatio: number;
  rankingWeeklyRatio: number;
  homeRatio: number;
  relatedRatio: number;
  tagWatchRatio: number;
  artistWatchRatio: number;
  manualRatio: number;
}

export interface RecentPreviewCandidate {
  pid: string;
  priority: number;
  candidateScore: number;
  sourceType: string;
  sourceKey?: string;
  sourceRecentAt?: string;
  popularity: number;
  view: number;
}

export interface BackfillPreviewCandidate extends RecentPreviewCandidate {}

export type BusinessCandidatePool =
  | 'ranking'
  | 'daily'
  | 'artist'
  | 'topic'
  | 'avatar'
  | 'wallpaper';

export type BusinessCandidateDownloadStatus = 'any' | 'preview' | 'regular' | 'original';

interface BusinessCandidateSourceRule {
  sourceType: PicSourceType;
  windowDays: number;
  bizType?: string;
}

export interface BusinessCandidateQuery {
  pool: BusinessCandidatePool;
  limit: number;
  topN?: number;
  excludePublished?: boolean;
  onlyDownloaded?: boolean;
  downloadStatus?: BusinessCandidateDownloadStatus;
  artistId?: string;
  tags?: string[];
}

export interface BusinessCandidateItem extends RecentPreviewCandidate {
  downloadStage: 'none' | 'preview' | 'full';
  lastSourceType?: string;
  bizType?: string;
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

export interface PicArchiveStateRow {
  pid: string;
  image_path: string;
  image_variants?: string;
  download_stage?: 'none' | 'preview' | 'full';
  preview_downloaded_at?: string;
  full_downloaded_at?: string;
}

export interface WatchTargetUpsertInput {
  id?: number;
  targetType: WatchTargetType;
  targetValue: string;
  bizType?: string;
  priority?: number;
  windowDays?: number;
  dailyPreviewQuota?: number;
  enabled?: boolean;
  meta?: string;
}

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

    if (!dbUrl) {
      throw new Error('Missing TURSO_DATABASE_URL');
    }
    // file: 本地文件模式不需要 token；远程 libsql:// 才需要
    if (!isFileUrl(dbUrl) && !token) {
      throw new Error('Missing TURSO_AUTH_TOKEN for remote libsql URL');
    }

    // Use shared client by default to keep one connection pool in process.
    this.client = url || authToken || syncUrl
      ? createLibsqlClient({ url: dbUrl, authToken: token, syncUrl: localSyncUrl })
      : getSharedLibsqlClient();

    if (localSyncUrl) {
      console.log('Turso 本地副本模式已启用，同步URL:', localSyncUrl);
    }

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
    const downloadStage = pic.download_stage && pic.download_stage !== 'none'
      ? pic.download_stage
      : null;
    const candidateScore =
      typeof pic.candidate_score === 'number' && Number.isFinite(pic.candidate_score)
        ? pic.candidate_score
        : null;

    try {
      await this.client.execute({
        sql: `
          INSERT INTO pic (
            pid, title, author_id, author_name, tag, good, star, view,
            image_path, image_url, popularity, download_time, upload_time,
            wx_url, wx_name, unfit, size,
            first_seen_at, last_seen_at, last_source_type,
            download_stage, preview_downloaded_at, full_downloaded_at, image_variants,
            candidate_score, created_at, updated_at
          ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
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
            first_seen_at = COALESCE(pic.first_seen_at, excluded.first_seen_at),
            last_seen_at = CASE
              WHEN excluded.last_seen_at IS NOT NULL
                AND (pic.last_seen_at IS NULL OR excluded.last_seen_at >= pic.last_seen_at)
              THEN excluded.last_seen_at
              ELSE pic.last_seen_at
            END,
            last_source_type = CASE
              WHEN excluded.last_source_type IS NOT NULL
                AND excluded.last_seen_at IS NOT NULL
                AND (pic.last_seen_at IS NULL OR excluded.last_seen_at >= pic.last_seen_at)
              THEN excluded.last_source_type
              ELSE COALESCE(pic.last_source_type, excluded.last_source_type)
            END,
            download_stage = COALESCE(excluded.download_stage, pic.download_stage),
            preview_downloaded_at = COALESCE(excluded.preview_downloaded_at, pic.preview_downloaded_at),
            full_downloaded_at = COALESCE(excluded.full_downloaded_at, pic.full_downloaded_at),
            image_variants = COALESCE(excluded.image_variants, pic.image_variants),
            candidate_score = COALESCE(excluded.candidate_score, pic.candidate_score),
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
          pic.first_seen_at || now,
          pic.last_seen_at || now,
          pic.last_source_type || null,
          downloadStage,
          pic.preview_downloaded_at || null,
          pic.full_downloaded_at || null,
          pic.image_variants || null,
          candidateScore,
          now,
          now,
          now
        ]
      });

      await this.refreshCandidateScores({ pids: [pic.pid] });

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
   * @returns DatabasePic �?null
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
      await this.upsertMinimalPics([pid]);

      const existing = await this.client.execute({
        sql: `
          SELECT image_path, image_variants, preview_downloaded_at, full_downloaded_at
          FROM pic
          WHERE pid = ?
        `,
        args: [pid]
      });

      const currentRow = existing.rows[0];
      const mergedPaths = this.normalizeArchivePaths([
        ...this.collectKnownArchivePaths(
          currentRow?.image_path as string | undefined,
          currentRow?.image_variants as string | undefined
        ),
        path
      ]);
      const archiveState = this.buildArchiveState(
        mergedPaths,
        currentRow?.preview_downloaded_at as string | undefined,
        currentRow?.full_downloaded_at as string | undefined,
        now
      );

      await this.client.execute({
        sql: `
          UPDATE pic SET
            image_path = ?,
            image_variants = ?,
            download_stage = ?,
            preview_downloaded_at = ?,
            full_downloaded_at = ?,
            image_url = COALESCE(?, image_url),
            upload_time = ?,
            size = COALESCE(?, size),
            updated_at = ?
          WHERE pid = ?
        `,
        args: [
          archiveState.imagePath,
          archiveState.imageVariants,
          archiveState.downloadStage,
          archiveState.previewDownloadedAt,
          archiveState.fullDownloadedAt,
          imgUrl || null,
          now,
          fileSize || null,
          now,
          pid
        ]
      });

      console.log('更新 Pic 下载信息完成:', {
        pid,
        image_path: archiveState.imagePath,
        download_stage: archiveState.downloadStage
      });
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

      await this.refreshCandidateScores({ pids: [pid] });

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
  async replacePicArchiveState(
    pid: string,
    paths: string[],
    timestamps?: {
      previewDownloadedAt?: string | null;
      fullDownloadedAt?: string | null;
    }
  ): Promise<void> {
    const archiveState = this.buildArchiveState(
      paths,
      timestamps?.previewDownloadedAt,
      timestamps?.fullDownloadedAt
    );

    await this.client.execute({
      sql: `
        UPDATE pic
        SET image_path = ?,
            image_variants = ?,
            download_stage = ?,
            preview_downloaded_at = ?,
            full_downloaded_at = ?,
            updated_at = ?
        WHERE pid = ?
      `,
      args: [
        archiveState.imagePath,
        archiveState.imageVariants,
        archiveState.downloadStage,
        archiveState.previewDownloadedAt,
        archiveState.fullDownloadedAt,
        this.now(),
        pid
      ]
    });
  }

  async listPicsForStorageReconcile(limit: number = 100, pids?: string[]): Promise<PicArchiveStateRow[]> {
    const safeLimit = Math.max(1, Math.min(limit, 500));
    const targetPids = Array.isArray(pids)
      ? pids.map(pid => this.normalizeText(pid)).filter((pid): pid is string => Boolean(pid))
      : [];

    try {
      if (targetPids.length > 0) {
        const placeholders = targetPids.map(() => '?').join(', ');
        const result = await this.client.execute({
          sql: `
            SELECT pid, image_path, image_variants, download_stage, preview_downloaded_at, full_downloaded_at
            FROM pic
            WHERE pid IN (${placeholders})
            ORDER BY COALESCE(updated_at, created_at, '') DESC
            LIMIT ?
          `,
          args: [...targetPids, safeLimit]
        });

        return result.rows.map(row => ({
          pid: row.pid as string,
          image_path: (row.image_path as string) || '',
          image_variants: row.image_variants as string | undefined,
          download_stage: (row.download_stage as PicArchiveStateRow['download_stage']) || 'none',
          preview_downloaded_at: row.preview_downloaded_at as string | undefined,
          full_downloaded_at: row.full_downloaded_at as string | undefined
        }));
      }

      const result = await this.client.execute({
        sql: `
          SELECT pid, image_path, image_variants, download_stage, preview_downloaded_at, full_downloaded_at
          FROM pic
          WHERE COALESCE(TRIM(image_path), '') <> ''
             OR COALESCE(TRIM(image_variants), '') NOT IN ('', '{}')
          ORDER BY COALESCE(updated_at, created_at, '') DESC
          LIMIT ?
        `,
        args: [safeLimit]
      });

      return result.rows.map(row => ({
        pid: row.pid as string,
        image_path: (row.image_path as string) || '',
        image_variants: row.image_variants as string | undefined,
        download_stage: (row.download_stage as PicArchiveStateRow['download_stage']) || 'none',
        preview_downloaded_at: row.preview_downloaded_at as string | undefined,
        full_downloaded_at: row.full_downloaded_at as string | undefined
      }));
    } catch (error) {
      console.error('list pics for storage reconcile failed:', error);
      return [];
    }
  }

  async upsertMinimalPics(pids: string[]): Promise<void> {
    const uniquePids = Array.from(new Set(pids));
    if (uniquePids.length === 0) return;

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

    try {
      // 执行一个轻量查询来触发同步
      const statements = uniquePids.map(pid => ({
        sql: `
          INSERT INTO pic (
            pid, tag, good, star, view, image_path, image_url, popularity,
            first_seen_at, last_seen_at, download_stage, image_variants, candidate_score,
            created_at, updated_at
          )
          VALUES (?, '', 0, 0, 0, '', '', 0, ?, ?, 'none', '{}', 0, ?, ?)
          ON CONFLICT(pid) DO NOTHING
        `,
        args: [pid, now, now, now, now]
      }));

      await this.client.batch(statements);

      console.log('批量 Upsert 最小 Pic 完成:', { count: uniquePids.length });
    } catch (error) {
      console.error('批量 Upsert 最小 Pic 失败:', error);
      throw error;
    }
  }


  async refreshCandidateScores(options?: { pids?: string[]; limit?: number }): Promise<number> {
    const requestedPids = Array.isArray(options?.pids)
      ? options.pids.map(pid => this.normalizeText(pid)).filter((pid): pid is string => Boolean(pid))
      : [];
    let targetPids = Array.from(new Set(requestedPids));

    if (targetPids.length === 0) {
      const safeLimit = Math.max(1, Math.min(options?.limit ?? 200, 2000));
      const result = await this.client.execute({
        sql: `
          SELECT pid
          FROM pic
          ORDER BY COALESCE(last_seen_at, updated_at, created_at, '') DESC
          LIMIT ?
        `,
        args: [safeLimit]
      });
      targetPids = result.rows.map(row => row.pid as string);
    }

    if (targetPids.length === 0) {
      return 0;
    }

    const candidateScoreSql = this.buildCalculatedCandidateScoreExpression('pic');

    for (const batch of this.chunkArray(targetPids, 200)) {
      const placeholders = batch.map(() => '?').join(', ');
      await this.client.execute({
        sql: `
          UPDATE pic
          SET candidate_score = ROUND(${candidateScoreSql}, 4)
          WHERE pid IN (${placeholders})
        `,
        args: batch
      });
    }

    return targetPids.length;
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
    const candidateScoreSql = this.buildEffectiveCandidateScoreExpression('p');

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
              COALESCE(p.download_stage, 'none') = 'none' OR
              p.image_path IS NULL OR
              TRIM(p.image_path) = '' OR
              TRIM(p.image_path) = '[]'
            )
          ORDER BY ${candidateScoreSql} DESC, COALESCE(p.popularity, 0) DESC, COALESCE(p.view, 0) DESC
          LIMIT ?
        `,
        args: [safePopularity, safeLimit]
      });

      return result.rows.map(row => row.pid as string);
    } catch (error) {
      console.error('获取预览候选 PID 失败:', error);
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

  private normalizeText(value?: string | null): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  private normalizeInteger(value?: number): number | null {
    if (!Number.isFinite(value)) return null;
    return Math.floor(value as number);
  }

  private normalizeReal(value?: number): number | null {
    if (!Number.isFinite(value)) return null;
    return Number(value);
  }

  private normalizeBoolean(value?: boolean): number {
    return value === false ? 0 : 1;
  }


  private chunkArray<T>(items: T[], size: number): T[][] {
    const safeSize = Math.max(1, Math.floor(size));
    const result: T[][] = [];
    for (let index = 0; index < items.length; index += safeSize) {
      result.push(items.slice(index, index + safeSize));
    }
    return result;
  }

  private buildCalculatedCandidateScoreExpression(picAlias: string = 'pic'): string {
    const recentAtExpr = `COALESCE(${picAlias}.last_seen_at, ${picAlias}.upload_time, ${picAlias}.first_seen_at, ${picAlias}.created_at)`;

    return `(
      (MIN(COALESCE(${picAlias}.popularity, 0), 1.5) * 520.0) +
      (MIN(COALESCE(${picAlias}.view, 0), 20000) / 20000.0 * 140.0) +
      (MIN(COALESCE(${picAlias}.star, 0), 12000) / 12000.0 * 120.0) +
      (MIN(COALESCE(${picAlias}.good, 0), 12000) / 12000.0 * 60.0) +
      CASE
        WHEN ${recentAtExpr} IS NULL OR TRIM(${recentAtExpr}) = '' THEN 0
        WHEN (julianday('now') - julianday(${recentAtExpr})) <= 1 THEN 220
        WHEN (julianday('now') - julianday(${recentAtExpr})) <= 3 THEN 180
        WHEN (julianday('now') - julianday(${recentAtExpr})) <= 7 THEN 130
        WHEN (julianday('now') - julianday(${recentAtExpr})) <= 14 THEN 90
        WHEN (julianday('now') - julianday(${recentAtExpr})) <= 30 THEN 50
        ELSE 15
      END +
      CASE COALESCE(${picAlias}.last_source_type, '')
        WHEN 'ranking_daily' THEN 160
        WHEN 'ranking_weekly' THEN 120
        WHEN 'home' THEN 100
        WHEN 'tag_watch' THEN 110
        WHEN 'artist_watch' THEN 105
        WHEN 'manual' THEN 95
        WHEN 'illust_recommend' THEN 75
        WHEN 'author_recommend' THEN 65
        WHEN 'ranking_monthly' THEN 55
        ELSE 20
      END
    )`;
  }

  private buildEffectiveCandidateScoreExpression(picAlias: string = 'pic'): string {
    const calculated = this.buildCalculatedCandidateScoreExpression(picAlias);
    return `(CASE WHEN COALESCE(${picAlias}.candidate_score, 0) > 0 THEN COALESCE(${picAlias}.candidate_score, 0) ELSE ${calculated} END)`;
  }

  private buildDownloadCandidatePriorityExpression(taskAlias: string = 't', picAlias: string = 'p'): string {
    const effectiveScore = this.buildEffectiveCandidateScoreExpression(picAlias);
    return `MAX(COALESCE(${taskAlias}.priority, 0), CAST(ROUND(${effectiveScore}) AS INTEGER))`;
  }

  private buildHasPreviewArchiveExpression(picAlias: string = 'p'): string {
    return `(
      COALESCE(${picAlias}.image_variants, '') LIKE '%"thumb_mini":"%' OR
      COALESCE(${picAlias}.image_variants, '') LIKE '%"small":"%' OR
      COALESCE(${picAlias}.image_path, '') LIKE '%/thumb_mini.%' OR
      COALESCE(${picAlias}.image_path, '') LIKE '%/small.%' OR
      COALESCE(${picAlias}.download_stage, 'none') IN ('preview', 'full')
    )`;
  }

  private buildHasRegularArchiveExpression(picAlias: string = 'p'): string {
    return `(
      COALESCE(${picAlias}.image_variants, '') LIKE '%"regular":"%' OR
      COALESCE(${picAlias}.image_path, '') LIKE '%/regular.%'
    )`;
  }

  private buildHasOriginalArchiveExpression(picAlias: string = 'p'): string {
    return `(
      COALESCE(${picAlias}.image_variants, '') LIKE '%"original":"%' OR
      COALESCE(${picAlias}.image_path, '') LIKE '%/original.%'
    )`;
  }

  private buildHasAnyArchiveExpression(picAlias: string = 'p'): string {
    return `(
      COALESCE(TRIM(${picAlias}.image_path), '') NOT IN ('', '[]') OR
      COALESCE(TRIM(${picAlias}.image_variants), '') NOT IN ('', '{}') OR
      COALESCE(${picAlias}.download_stage, 'none') <> 'none'
    )`;
  }

  private buildDownloadStatusExpression(
    filter: BusinessCandidateDownloadStatus = 'any',
    picAlias: string = 'p'
  ): string | null {
    switch (filter) {
      case 'preview':
        return `(${this.buildHasPreviewArchiveExpression(picAlias)}) AND NOT (${this.buildHasRegularArchiveExpression(picAlias)}) AND NOT (${this.buildHasOriginalArchiveExpression(picAlias)})`;
      case 'regular':
        return this.buildHasRegularArchiveExpression(picAlias);
      case 'original':
        return this.buildHasOriginalArchiveExpression(picAlias);
      default:
        return null;
    }
  }

  private buildPublishedExclusionExpression(pidExpr: string = 'p.pid'): string {
    return `(
      NOT EXISTS (
        SELECT 1
        FROM daily_pick_artwork dpa
        INNER JOIN daily_pick dp ON dp.id = dpa.daily_pick_id
        WHERE dpa.pid = ${pidExpr}
          AND COALESCE(dp.is_published, 0) = 1
      )
      AND NOT EXISTS (
        SELECT 1
        FROM artist_feature_artwork afa
        INNER JOIN artist_feature af ON af.id = afa.artist_feature_id
        WHERE afa.pid = ${pidExpr}
          AND COALESCE(af.is_published, 0) = 1
      )
      AND NOT EXISTS (
        SELECT 1
        FROM topic_feature_artwork tfa
        INNER JOIN topic_feature tf ON tf.id = tfa.topic_feature_id
        WHERE tfa.pid = ${pidExpr}
          AND COALESCE(tf.is_published, 0) = 1
      )
      AND NOT EXISTS (
        SELECT 1
        FROM daily_pick dp
        WHERE dp.cover_pid = ${pidExpr}
          AND COALESCE(dp.is_published, 0) = 1
      )
      AND NOT EXISTS (
        SELECT 1
        FROM artist_feature af
        WHERE af.cover_pid = ${pidExpr}
          AND COALESCE(af.is_published, 0) = 1
      )
      AND NOT EXISTS (
        SELECT 1
        FROM topic_feature tf
        WHERE tf.cover_pid = ${pidExpr}
          AND COALESCE(tf.is_published, 0) = 1
      )
    )`;
  }

  private sampleCandidates<T>(items: T[], limit: number): T[] {
    if (items.length <= limit) {
      return items;
    }

    const cloned = [...items];
    for (let index = cloned.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [cloned[index], cloned[swapIndex]] = [cloned[swapIndex], cloned[index]];
    }

    return cloned.slice(0, limit);
  }

  private getBusinessCandidateSourceRules(pool: BusinessCandidatePool): BusinessCandidateSourceRule[] {
    switch (pool) {
      case 'ranking':
        return [
          { sourceType: 'ranking_daily', windowDays: 3 },
          { sourceType: 'ranking_weekly', windowDays: 7 },
          { sourceType: 'ranking_monthly', windowDays: 14 }
        ];
      case 'daily':
        return [
          { sourceType: 'ranking_daily', windowDays: 3 },
          { sourceType: 'ranking_weekly', windowDays: 7 },
          { sourceType: 'home', windowDays: 7 },
          { sourceType: 'illust_recommend', windowDays: 7 },
          { sourceType: 'author_recommend', windowDays: 14 }
        ];
      case 'topic':
        return [
          { sourceType: 'tag_watch', windowDays: 7, bizType: 'topic' }
        ];
      case 'avatar':
        return [
          { sourceType: 'tag_watch', windowDays: 7, bizType: 'avatar' }
        ];
      case 'wallpaper':
        return [
          { sourceType: 'tag_watch', windowDays: 7, bizType: 'wallpaper' }
        ];
      case 'artist':
        return [
          { sourceType: 'artist_watch', windowDays: 14, bizType: 'artist' },
          { sourceType: 'manual', windowDays: 30 }
        ];
      default:
        return [];
    }
  }

  private buildBusinessCandidateSourceWhere(
    rules: BusinessCandidateSourceRule[]
  ): { sql: string; args: Array<string | number> } {
    const clauses: string[] = [];
    const args: Array<string | number> = [];

    for (const rule of rules) {
      const since = new Date(Date.now() - Math.max(1, Math.floor(rule.windowDays)) * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 19)
        .replace('T', ' ');

      if (rule.bizType) {
        clauses.push(`(
          s.source_type = ?
          AND COALESCE(s.discovered_at, s.created_at) >= ?
          AND COALESCE(s.biz_type, '') = ?
        )`);
        args.push(rule.sourceType, since, rule.bizType);
        continue;
      }

      clauses.push(`(
        s.source_type = ?
        AND COALESCE(s.discovered_at, s.created_at) >= ?
      )`);
      args.push(rule.sourceType, since);
    }

    return {
      sql: clauses.length > 0 ? clauses.join(' OR ') : '1 = 0',
      args
    };
  }

  private normalizeArchivePaths(paths: Array<string | null | undefined>): string[] {
    return Array.from(
      new Set(
        paths
          .map(path => this.normalizeText(path))
          .filter((path): path is string => Boolean(path))
      )
    );
  }

  private parseImageVariantsValue(raw?: string | null): Partial<Record<PixivImageSize, string>> {
    if (!raw) return {};

    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {};
      }

      const variants: Partial<Record<PixivImageSize, string>> = {};
      for (const size of ['thumb_mini', 'small', 'regular', 'original'] as const) {
        const value = parsed[size];
        if (typeof value === 'string' && value.trim()) {
          variants[size] = value.trim();
        }
      }

      return variants;
    } catch {
      return {};
    }
  }

  private collectKnownArchivePaths(imagePath?: string | null, imageVariants?: string | null): string[] {
    const pathValues = parseImagePathValue(imagePath);
    const variantValues = Object.values(this.parseImageVariantsValue(imageVariants));
    return this.normalizeArchivePaths([...pathValues, ...variantValues]);
  }

  private buildArchiveState(
    paths: string[],
    existingPreviewDownloadedAt?: string | null,
    existingFullDownloadedAt?: string | null,
    archivedAt?: string | null
  ): {
    imagePath: string;
    imageVariants: string;
    downloadStage: 'none' | 'preview' | 'full';
    previewDownloadedAt: string | null;
    fullDownloadedAt: string | null;
  } {
    const normalizedPaths = this.normalizeArchivePaths(paths);
    const variants = buildImageVariantMap(normalizedPaths);
    const hasAny = normalizedPaths.length > 0;
    const hasFull = Boolean(variants.original || variants.regular);
    const fullDownloadedAt = hasFull ? (existingFullDownloadedAt || archivedAt || null) : null;
    const previewDownloadedAt = hasAny ? (existingPreviewDownloadedAt || fullDownloadedAt || archivedAt || null) : null;

    return {
      imagePath: normalizedPaths.length > 0 ? JSON.stringify(normalizedPaths) : '',
      imageVariants: JSON.stringify(variants),
      downloadStage: hasFull ? 'full' : hasAny ? 'preview' : 'none',
      previewDownloadedAt,
      fullDownloadedAt
    };
  }

  private isPersistableSourceType(value?: string | null): value is PicSourceType {
    return Boolean(value && value !== 'unknown');
  }

  async upsertPicSource(source: PicSourceUpsertInput): Promise<void> {
    await this.batchUpsertPicSources([source]);
  }

  async batchUpsertPicSources(sources: PicSourceUpsertInput[]): Promise<void> {
    if (!sources.length) return;

    const now = this.now();
    const deduped = new Map<string, {
      pid: string;
      sourceType: PicSourceType;
      sourceKey: string;
      discoveredAt: string;
      bizType: string | null;
      rankValue: number | null;
      sourceScore: number | null;
      meta: string | null;
    }>();

    for (const source of sources) {
      const pid = this.normalizeText(source.pid);
      const sourceType = this.normalizeText(source.sourceType);
      const sourceKey = this.normalizeText(source.sourceKey);
      if (!pid || !sourceType || !sourceKey || !this.isPersistableSourceType(sourceType)) {
        continue;
      }

      const normalizedSource = {
        pid,
        sourceType,
        sourceKey,
        discoveredAt: this.normalizeSourceRecentAt(source.discoveredAt) || now,
        bizType: this.normalizeText(source.bizType),
        rankValue: this.normalizeInteger(source.rankValue),
        sourceScore: this.normalizeReal(source.sourceScore),
        meta: this.normalizeText(source.meta)
      };

      const dedupeKey = `${pid}::${sourceType}::${sourceKey}`;
      const existing = deduped.get(dedupeKey);
      if (!existing) {
        deduped.set(dedupeKey, normalizedSource);
        continue;
      }

      deduped.set(dedupeKey, {
        pid,
        sourceType,
        sourceKey,
        discoveredAt: normalizedSource.discoveredAt >= existing.discoveredAt
          ? normalizedSource.discoveredAt
          : existing.discoveredAt,
        bizType: normalizedSource.bizType || existing.bizType,
        rankValue: normalizedSource.rankValue ?? existing.rankValue,
        sourceScore: normalizedSource.sourceScore ?? existing.sourceScore,
        meta: normalizedSource.meta || existing.meta
      });
    }

    if (deduped.size === 0) {
      return;
    }

    try {
      await this.client.batch(
        Array.from(deduped.values()).map(source => ({
          sql: `
            INSERT INTO pic_source (
              pid, source_type, source_key, biz_type, rank_value,
              source_score, meta, discovered_at, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(pid, source_type, source_key) DO UPDATE SET
              biz_type = COALESCE(excluded.biz_type, pic_source.biz_type),
              rank_value = COALESCE(excluded.rank_value, pic_source.rank_value),
              source_score = COALESCE(excluded.source_score, pic_source.source_score),
              meta = COALESCE(excluded.meta, pic_source.meta),
              discovered_at = CASE
                WHEN excluded.discovered_at > COALESCE(pic_source.discovered_at, '')
                THEN excluded.discovered_at
                ELSE pic_source.discovered_at
              END,
              updated_at = excluded.updated_at
          `,
          args: [
            source.pid,
            source.sourceType,
            source.sourceKey,
            source.bizType,
            source.rankValue,
            source.sourceScore,
            source.meta,
            source.discoveredAt,
            now,
            now
          ]
        }))
      );

      await this.client.batch(
        Array.from(deduped.values()).map(source => ({
          sql: `
            INSERT INTO pic (
              pid, tag, good, star, view, image_path, image_url, popularity,
              first_seen_at, last_seen_at, last_source_type, download_stage, image_variants, candidate_score,
              created_at, updated_at
            )
            VALUES (?, '', 0, 0, 0, '', '', 0, ?, ?, ?, 'none', '{}', 0, ?, ?)
            ON CONFLICT(pid) DO UPDATE SET
              last_seen_at = CASE
                WHEN excluded.last_seen_at > COALESCE(pic.last_seen_at, '')
                THEN excluded.last_seen_at
                ELSE pic.last_seen_at
              END,
              last_source_type = CASE
                WHEN excluded.last_seen_at > COALESCE(pic.last_seen_at, '')
                THEN excluded.last_source_type
                ELSE COALESCE(pic.last_source_type, excluded.last_source_type)
              END,
              updated_at = excluded.updated_at
          `,
          args: [
            source.pid,
            source.discoveredAt,
            source.discoveredAt,
            source.sourceType,
            now,
            now
          ]
        }))
      );

      await this.refreshCandidateScores({
        pids: Array.from(new Set(Array.from(deduped.values()).map(source => source.pid)))
      });
    } catch (error) {
      console.error('batch upsert pic_source failed:', error);
      throw error;
    }
  }

  async listWatchTargets(enabledOnly: boolean = false): Promise<WatchTarget[]> {
    try {
      const result = await this.client.execute({
        sql: `
          SELECT *
          FROM watch_target
          ${enabledOnly ? 'WHERE enabled = 1' : ''}
          ORDER BY COALESCE(priority, 0) DESC, id ASC
        `,
        args: []
      });

      return result.rows.map(row => this.rowToWatchTarget(row));
    } catch (error) {
      console.error('list watch_target failed:', error);
      return [];
    }
  }

  async getRunnableWatchTargets(limit: number = 20, ids?: number[]): Promise<WatchTarget[]> {
    const safeLimit = Math.max(1, Math.min(limit, 200));
    const targetIds = Array.isArray(ids)
      ? ids.map(id => Number(id)).filter(id => Number.isFinite(id) && id > 0)
      : [];
    const args: Array<number> = [];
    let idFilterSql = '';

    if (targetIds.length > 0) {
      idFilterSql = ` AND id IN (${targetIds.map(() => '?').join(', ')})`;
      args.push(...targetIds);
    }

    args.push(safeLimit);

    try {
      const result = await this.client.execute({
        sql: `
          SELECT *
          FROM watch_target
          WHERE enabled = 1
          ${idFilterSql}
          ORDER BY COALESCE(priority, 0) DESC, COALESCE(last_run_at, '') ASC, id ASC
          LIMIT ?
        `,
        args
      });

      return result.rows.map(row => this.rowToWatchTarget(row));
    } catch (error) {
      console.error('get runnable watch_target failed:', error);
      return [];
    }
  }

  async upsertWatchTarget(input: WatchTargetUpsertInput): Promise<WatchTarget> {
    const now = this.now();
    const targetType = this.normalizeText(input.targetType);
    const targetValue = this.normalizeText(input.targetValue);
    const bizType = this.normalizeText(input.bizType) || 'general';
    const priority = this.buildPicTaskPriorityValue(input.priority ?? 500);
    const windowDays = Number.isFinite(input.windowDays) ? Math.max(1, Math.floor(input.windowDays as number)) : 7;
    const dailyPreviewQuota = Number.isFinite(input.dailyPreviewQuota)
      ? Math.max(1, Math.floor(input.dailyPreviewQuota as number))
      : 50;
    const enabled = input.enabled === undefined ? undefined : this.normalizeBoolean(input.enabled);
    const meta = this.normalizeText(input.meta);

    if ((targetType !== 'tag' && targetType !== 'artist') || !targetValue) {
      throw new Error('Invalid watch target payload');
    }

    if (Number.isFinite(input.id)) {
      await this.client.execute({
        sql: `
          UPDATE watch_target
          SET target_type = ?,
              target_value = ?,
              biz_type = ?,
              priority = ?,
              window_days = ?,
              daily_preview_quota = ?,
              enabled = COALESCE(?, enabled),
              meta = ?,
              updated_at = ?
          WHERE id = ?
        `,
        args: [
          targetType,
          targetValue,
          bizType,
          priority,
          windowDays,
          dailyPreviewQuota,
          enabled ?? null,
          meta,
          now,
          Number(input.id)
        ]
      });

      const updated = await this.client.execute({
        sql: 'SELECT * FROM watch_target WHERE id = ? LIMIT 1',
        args: [Number(input.id)]
      });
      if (updated.rows.length === 0) {
        throw new Error(`watch_target not found: ${input.id}`);
      }
      return this.rowToWatchTarget(updated.rows[0]);
    }

    await this.client.execute({
      sql: `
        INSERT INTO watch_target (
          target_type, target_value, biz_type, priority, window_days,
          daily_preview_quota, enabled, meta, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(target_type, target_value, biz_type) DO UPDATE SET
          priority = excluded.priority,
          window_days = excluded.window_days,
          daily_preview_quota = excluded.daily_preview_quota,
          enabled = COALESCE(excluded.enabled, watch_target.enabled),
          meta = COALESCE(excluded.meta, watch_target.meta),
          updated_at = excluded.updated_at
      `,
      args: [
        targetType,
        targetValue,
        bizType,
        priority,
        windowDays,
        dailyPreviewQuota,
        enabled ?? 1,
        meta,
        now,
        now
      ]
    });

    const result = await this.client.execute({
      sql: `
        SELECT *
        FROM watch_target
        WHERE target_type = ? AND target_value = ? AND biz_type = ?
        LIMIT 1
      `,
      args: [targetType, targetValue, bizType]
    });

    if (result.rows.length === 0) {
      throw new Error('Failed to upsert watch_target');
    }

    return this.rowToWatchTarget(result.rows[0]);
  }

  async deleteWatchTarget(id: number): Promise<void> {
    await this.client.execute({
      sql: 'DELETE FROM watch_target WHERE id = ?',
      args: [id]
    });
  }

  async markWatchTargetRun(id: number, runAt?: string): Promise<void> {
    const lastRunAt = this.normalizeSourceRecentAt(runAt) || this.now();
    const now = this.now();
    await this.client.execute({
      sql: 'UPDATE watch_target SET last_run_at = ?, updated_at = ? WHERE id = ?',
      args: [lastRunAt, now, id]
    });
  }

  // ========================================
  // pic_task 表操作  // ========================================

  /**
   * 创建或更新 pic_task 记录
   * @param pid 图片ID
   */
  async createOrUpdatePicTask(pid: string, options?: PicTaskUpsertOptions): Promise<void> {
    const now = this.now();
    const priority = this.buildPicTaskPriorityValue(options?.priority);
    const sourceType = options?.sourceType || 'unknown';
    const sourceKey = this.normalizeText(options?.sourceKey);
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

      if (this.isPersistableSourceType(sourceType) && sourceKey) {
        await this.upsertPicSource({
          pid,
          sourceType,
          sourceKey,
          discoveredAt: sourceRecentAt || now
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
    const sourceKey = this.normalizeText(options?.sourceKey);
    const sourceRecentAt = this.normalizeSourceRecentAt(options?.sourceRecentAt);

    try {
      await this.upsertMinimalPics(uniquePids);

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

      if (this.isPersistableSourceType(sourceType) && sourceKey) {
        await this.batchUpsertPicSources(
          uniquePids.map(pid => ({
            pid,
            sourceType,
            sourceKey,
            discoveredAt: sourceRecentAt || now
          }))
        );
      }

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
   * @returns PicTask �?null
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

      console.log('更新详细信息状态完成:', { pid });
    } catch (error) {
      console.error('更新详细信息状态失败:', error);
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
      await this.batchUpsertPicSources(
        items.map(item => ({
          pid: item.pid,
          sourceType,
          sourceKey: `${type}:${rankDate}`,
          discoveredAt: sourceRecentAt,
          bizType: 'ranking',
          rankValue: item.rank,
          sourceScore: getPriority(item.rank)
        }))
      );
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
        types: ['tag_watch'],
        windowDays: windowConfig.tagWatchDays,
        ratio: quotaConfig.tagWatchRatio
      },
      {
        types: ['artist_watch'],
        windowDays: windowConfig.artistWatchDays,
        ratio: quotaConfig.artistWatchRatio
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
      const fallbackTypes = [
        'ranking_daily',
        'ranking_weekly',
        'ranking_monthly',
        'home',
        'illust_recommend',
        'author_recommend',
        'tag_watch',
        'artist_watch',
        'manual'
      ];
      const fallbackWindowDays = Math.max(
        windowConfig.rankingDailyDays,
        windowConfig.rankingWeeklyDays,
        windowConfig.rankingMonthlyDays,
        windowConfig.homeDays,
        windowConfig.illustRecommendDays,
        windowConfig.authorRecommendDays,
        windowConfig.tagWatchDays,
        windowConfig.artistWatchDays,
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
    const args: Array<string | number> = [...sourceTypes, since, minPopularity];
    const candidateScoreSql = this.buildEffectiveCandidateScoreExpression('p');
    const prioritySql = this.buildDownloadCandidatePriorityExpression('t', 'p');
    let excludeSql = '';
    if (excludePids.length > 0) {
      excludeSql = ` AND p.pid NOT IN (${excludePids.map(() => '?').join(', ')})`;
      args.push(...excludePids);
    }

    args.push(limit);

    try {
      const result = await this.client.execute({
        sql: `
          WITH matched_source AS (
            SELECT
              s.pid,
              s.source_type,
              s.source_key,
              s.discovered_at,
              ROW_NUMBER() OVER (
                PARTITION BY s.pid
                ORDER BY COALESCE(s.discovered_at, s.created_at) DESC, s.id DESC
              ) AS rn
            FROM pic_source s
            WHERE s.source_type IN (${sourcePlaceholders})
              AND COALESCE(s.discovered_at, s.created_at) >= ?
          )
          SELECT
            p.pid,
            ${prioritySql} AS priority,
            ROUND(${candidateScoreSql}, 4) AS candidate_score,
            COALESCE(matched_source.source_type, p.last_source_type, 'unknown') AS source_type,
            matched_source.source_key AS source_key,
            COALESCE(matched_source.discovered_at, p.last_seen_at, p.first_seen_at) AS source_recent_at,
            COALESCE(p.popularity, 0) AS popularity,
            COALESCE(p.view, 0) AS view
          FROM matched_source
          INNER JOIN pic p ON p.pid = matched_source.pid
          INNER JOIN pic_task t ON t.pid = p.pid
          WHERE matched_source.rn = 1
            AND p.unfit = 0
            AND COALESCE(p.popularity, 0) >= ?
            AND t.detail_info_crawled = 1
            AND (
              COALESCE(p.download_stage, 'none') = 'none' OR
              p.image_path IS NULL OR
              TRIM(p.image_path) = '' OR
              TRIM(p.image_path) = '[]'
            )
            AND NOT EXISTS (
              SELECT 1
              FROM download_job j
              WHERE j.pid = p.pid
                AND j.job_type IN ('preview', 'backfill')
                AND j.status IN ('pending', 'running', 'success')
            )
            ${excludeSql}
          ORDER BY
            candidate_score DESC,
            ${prioritySql} DESC,
            COALESCE(p.popularity, 0) DESC,
            COALESCE(p.view, 0) DESC,
            COALESCE(matched_source.discovered_at, p.last_seen_at, p.first_seen_at, p.created_at) DESC
          LIMIT ?
        `,
        args
      });

      return result.rows.map(row => ({
        pid: row.pid as string,
        priority: Number(row.priority) || 0,
        candidateScore: Number(row.candidate_score) || 0,
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

  async getBusinessCandidatePool(query: BusinessCandidateQuery): Promise<BusinessCandidateItem[]> {
    const safeLimit = Math.max(1, Math.min(query.limit, 200));
    const safeTopN = Math.max(safeLimit, Math.min(query.topN || query.limit || 200, 1000));
    const rules = this.getBusinessCandidateSourceRules(query.pool);
    if (rules.length === 0) {
      return [];
    }

    const { sql: sourceWhereSql, args } = this.buildBusinessCandidateSourceWhere(rules);
    const candidateScoreSql = this.buildEffectiveCandidateScoreExpression('p');
    const prioritySql = this.buildDownloadCandidatePriorityExpression('t', 'p');
    const onlyDownloaded = query.onlyDownloaded !== false;
    const tags = Array.from(new Set((query.tags || []).map(tag => tag.trim()).filter(Boolean)));
    const artistId = this.normalizeText(query.artistId);

    let tagWhereSql = '';
    if (tags.length > 0) {
      const clauses = tags.map(() => `(COALESCE(p.tag, '') LIKE ? OR COALESCE(matched_source.source_key, '') = ?)`);
      tagWhereSql = ` AND (${clauses.join(' OR ')})`;
      for (const tag of tags) {
        args.push(`%${tag}%`, `tag:${tag}`);
      }
    }

    let artistWhereSql = '';
    if (artistId) {
      artistWhereSql = ` AND (COALESCE(p.author_id, '') = ? OR COALESCE(matched_source.source_key, '') = ?)`;
      args.push(artistId, `artist:${artistId}`);
    }

    const whereParts = [
      'matched_source.rn = 1',
      'COALESCE(p.unfit, 0) = 0',
      'COALESCE(t.detail_info_crawled, 1) = 1'
    ];

    if (query.excludePublished !== false) {
      whereParts.push(this.buildPublishedExclusionExpression('p.pid'));
    }

    if (onlyDownloaded) {
      whereParts.push(this.buildHasAnyArchiveExpression('p'));
    }

    const downloadStatusSql = this.buildDownloadStatusExpression(query.downloadStatus || 'any', 'p');
    if (downloadStatusSql) {
      whereParts.push(downloadStatusSql);
    }

    args.push(safeTopN);

    try {
      const result = await this.client.execute({
        sql: `
          WITH matched_source AS (
            SELECT
              s.pid,
              s.source_type,
              s.source_key,
              s.biz_type,
              COALESCE(s.discovered_at, s.created_at) AS source_recent_at,
              ROW_NUMBER() OVER (
                PARTITION BY s.pid
                ORDER BY COALESCE(s.discovered_at, s.created_at) DESC, s.id DESC
              ) AS rn
            FROM pic_source s
            WHERE ${sourceWhereSql}
          )
          SELECT
            p.pid,
            ${prioritySql} AS priority,
            ROUND(${candidateScoreSql}, 4) AS candidate_score,
            COALESCE(matched_source.source_type, p.last_source_type, 'unknown') AS source_type,
            matched_source.source_key AS source_key,
            matched_source.source_recent_at AS source_recent_at,
            COALESCE(p.popularity, 0) AS popularity,
            COALESCE(p.view, 0) AS view,
            COALESCE(p.download_stage, 'none') AS download_stage,
            p.last_source_type AS last_source_type,
            matched_source.biz_type AS biz_type
          FROM matched_source
          INNER JOIN pic p ON p.pid = matched_source.pid
          LEFT JOIN pic_task t ON t.pid = p.pid
          WHERE ${whereParts.join(' AND ')}
            ${tagWhereSql}
            ${artistWhereSql}
          ORDER BY
            candidate_score DESC,
            ${prioritySql} DESC,
            COALESCE(p.popularity, 0) DESC,
            COALESCE(p.view, 0) DESC,
            COALESCE(matched_source.source_recent_at, p.last_seen_at, p.first_seen_at, p.created_at) DESC
          LIMIT ?
        `,
        args
      });

      const rows = result.rows.map(row => ({
        pid: row.pid as string,
        priority: Number(row.priority) || 0,
        candidateScore: Number(row.candidate_score) || 0,
        sourceType: row.source_type as string,
        sourceKey: row.source_key as string | undefined,
        sourceRecentAt: row.source_recent_at as string | undefined,
        popularity: Number(row.popularity) || 0,
        view: Number(row.view) || 0,
        downloadStage: (row.download_stage as BusinessCandidateItem['downloadStage']) || 'none',
        lastSourceType: row.last_source_type as string | undefined,
        bizType: row.biz_type as string | undefined
      }));

      return this.sampleCandidates(rows, safeLimit);
    } catch (error) {
      console.error('query business candidate pool failed:', error);
      return [];
    }
  }

  async getBackfillPreviewCandidates(
    limit: number,
    minPopularity: number,
    minAgeDays: number
  ): Promise<BackfillPreviewCandidate[]> {
    const safeLimit = Math.max(1, Math.min(limit, 500));
    const safePopularity = Number.isFinite(minPopularity) ? minPopularity : 0;
    const safeMinAgeDays = Math.max(1, Math.floor(minAgeDays));
    const candidateScoreSql = this.buildEffectiveCandidateScoreExpression('p');
    const prioritySql = this.buildDownloadCandidatePriorityExpression('t', 'p');
    const recentAtExpr = `COALESCE(p.last_seen_at, p.upload_time, p.first_seen_at, p.created_at)`;

    try {
      const result = await this.client.execute({
        sql: `
          WITH latest_source AS (
            SELECT
              s.pid,
              s.source_type,
              s.source_key,
              s.discovered_at,
              ROW_NUMBER() OVER (
                PARTITION BY s.pid
                ORDER BY COALESCE(s.discovered_at, s.created_at) DESC, s.id DESC
              ) AS rn
            FROM pic_source s
          )
          SELECT
            p.pid,
            ${prioritySql} AS priority,
            ROUND(${candidateScoreSql}, 4) AS candidate_score,
            COALESCE(latest_source.source_type, p.last_source_type, 'backfill') AS source_type,
            latest_source.source_key AS source_key,
            COALESCE(latest_source.discovered_at, p.last_seen_at, p.first_seen_at, p.created_at) AS source_recent_at,
            COALESCE(p.popularity, 0) AS popularity,
            COALESCE(p.view, 0) AS view
          FROM pic p
          INNER JOIN pic_task t ON t.pid = p.pid
          LEFT JOIN latest_source
            ON latest_source.pid = p.pid
           AND latest_source.rn = 1
          WHERE p.unfit = 0
            AND COALESCE(p.popularity, 0) >= ?
            AND t.detail_info_crawled = 1
            AND ${recentAtExpr} IS NOT NULL
            AND TRIM(${recentAtExpr}) <> ''
            AND (julianday('now') - julianday(${recentAtExpr})) >= ?
            AND (
              COALESCE(p.download_stage, 'none') = 'none' OR
              p.image_path IS NULL OR
              TRIM(p.image_path) = '' OR
              TRIM(p.image_path) = '[]'
            )
            AND NOT EXISTS (
              SELECT 1
              FROM download_job j
              WHERE j.pid = p.pid
                AND j.job_type IN ('preview', 'backfill')
                AND j.status IN ('pending', 'running', 'success')
            )
          ORDER BY
            candidate_score DESC,
            ${prioritySql} DESC,
            COALESCE(p.popularity, 0) DESC,
            COALESCE(p.view, 0) DESC,
            COALESCE(p.last_seen_at, p.first_seen_at, p.created_at, '') DESC
          LIMIT ?
        `,
        args: [safePopularity, safeMinAgeDays, safeLimit]
      });

      return result.rows.map(row => ({
        pid: row.pid as string,
        priority: Number(row.priority) || 0,
        candidateScore: Number(row.candidate_score) || 0,
        sourceType: row.source_type as string,
        sourceKey: row.source_key as string | undefined,
        sourceRecentAt: row.source_recent_at as string | undefined,
        popularity: Number(row.popularity) || 0,
        view: Number(row.view) || 0
      }));
    } catch (error) {
      console.error('query backfill preview candidates failed:', error);
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
            AND status IN ('pending', 'failed')
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
                finished_at = NULL,
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
      size: row.size ? Number(row.size) : undefined,
      first_seen_at: row.first_seen_at as string | undefined,
      last_seen_at: row.last_seen_at as string | undefined,
      last_source_type: row.last_source_type as string | undefined,
      download_stage: (row.download_stage as DatabasePic['download_stage']) || 'none',
      preview_downloaded_at: row.preview_downloaded_at as string | undefined,
      full_downloaded_at: row.full_downloaded_at as string | undefined,
      image_variants: row.image_variants as string | undefined,
      candidate_score: row.candidate_score === null || row.candidate_score === undefined
        ? undefined
        : Number(row.candidate_score)
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

  private rowToWatchTarget(row: any): WatchTarget {
    return {
      id: Number(row.id),
      target_type: (row.target_type as WatchTarget['target_type']) || 'tag',
      target_value: row.target_value as string,
      biz_type: (row.biz_type as string) || 'general',
      priority: row.priority ? Number(row.priority) : 0,
      window_days: row.window_days ? Number(row.window_days) : 7,
      daily_preview_quota: row.daily_preview_quota ? Number(row.daily_preview_quota) : 50,
      enabled: row.enabled === undefined ? true : Boolean(row.enabled),
      last_run_at: row.last_run_at as string | undefined,
      meta: row.meta as string | undefined,
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
   * 同步本地副本 (用于 Local Read Replica 模式)
   * 在东京服务器上定期调用以保持数据同步
   */
  async sync(): Promise<void> {
    try {
      // @libsql/client 会自动处理同步，这里只是显式触发
      console.log('触发 Turso 本地副本同步...');
      // 执行一个轻量查询来触发同步
      await this.client.execute('SELECT 1');
      console.log('Turso sync complete');
    } catch (error) {
      console.error('Turso 同步失败:', error);
    }
  }

  /**
   * 关闭数据库连接
   */
  async close(): Promise<void> {
    this.client.close();
    console.log('Turso connection closed');
  }
}
