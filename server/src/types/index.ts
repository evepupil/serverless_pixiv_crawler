// ========================================
// Pixiv API 相关类型定义
// ========================================

export interface PixivIllustInfo {
  body: {
    userId: string;
    title: string;
    userName: string;
    tags: {
      tags: Array<{
        tag: string;
        translation?: {
          en: string;
        };
      }>;
    };
    likeCount: number;
    bookmarkCount: number;
    viewCount: number;
    illusts?: Array<{ id: string }>;
    recommendUsers?: Array<{
      userId: string;
      illustIds: string[];
    }>;
  };
  error: boolean | string;
}

// 用于处理 404 错误的类型
export interface PixivIllustError {
  error: true;
  status: 404;
  message: string;
}

// 联合类型：正常的插画信息或 404 错误
export type PixivIllustResult = PixivIllustInfo | PixivIllustError;

export interface PixivRecommendResponse {
  body: {
    illusts: Array<{ id: string }>;
  };
  error: boolean;
}

export interface PixivUserRecommendResponse {
  body: {
    recommendUsers: Array<{
      userId: string;
      illustIds: string[];
    }>;
  };
  error: boolean;
}

export interface PixivDailyRankItem {
  pid: string;
  rank: number;
  crawl_time: string;
}

export interface PixivDailyRankResponse {
  body: {
    rankings: PixivDailyRankItem[];
  };
  error: boolean;
}

// Pixiv 排行榜 JSON API 响应类型
export interface PixivRankingJsonItem {
  illust_id: number;
  rank: number;
  title: string;
  tags: string[];
  user_id: number;
  user_name: string;
  rating_count: number;
  view_count: number;
  url: string;
  width: number;
  height: number;
}

export interface PixivRankingJsonResponse {
  contents: PixivRankingJsonItem[];
  mode: string;
  content: string;
  page: number;
  rank_total: number;
}

export interface PixivHeaders {
  'User-Agent': string;
  cookie: string;
  Referer: string;
  'Accept-Language': string;
  [key: string]: string;
}

export interface IllustData {
  like: number;
  bookmark: number;
  view: number;
}

// ========================================
// 数据库相关类型定义
// ========================================

export interface DatabasePic {
  pid: string;
  title?: string;           // ????
  author_id?: string;       // ??ID
  author_name?: string;     // ????
  download_time?: string;
  tag: string;
  good: number;
  star: number;
  view: number;
  image_path: string;
  image_url: string;
  popularity: number;
  upload_time?: string;
  wx_url?: string;
  wx_name?: string;
  unfit?: boolean;
  size?: number;            // ??????????
  first_seen_at?: string;
  last_seen_at?: string;
  last_source_type?: string;
  download_stage?: 'none' | 'preview' | 'full';
  preview_downloaded_at?: string;
  full_downloaded_at?: string;
  image_variants?: string;
  candidate_score?: number;
}

// pic_task 表类型定义
export interface PicTask {
  pid: string;
  illust_recommend_crawled: boolean;
  illust_recommend_time?: string;
  illust_recommend_count?: number;
  author_recommend_crawled: boolean;
  author_recommend_time?: string;
  author_recommend_count?: number;
  detail_info_crawled: boolean;
  detail_info_time?: string;
  priority?: number;
  task_source_type?: string;
  task_source_key?: string;
  source_recent_at?: string;
  attempt_count?: number;
  next_retry_at?: string;
  last_error?: string;
  created_at?: string;
  updated_at?: string;
}

export interface PicSource {
  id: number;
  pid: string;
  source_type: string;
  source_key: string;
  biz_type?: string;
  rank_value?: number;
  source_score?: number;
  meta?: string;
  discovered_at: string;
  created_at?: string;
  updated_at?: string;
}

export interface WatchTarget {
  id: number;
  target_type: 'tag' | 'artist';
  target_value: string;
  biz_type: string;
  priority?: number;
  window_days?: number;
  daily_preview_quota?: number;
  enabled?: boolean;
  last_run_at?: string;
  meta?: string;
  created_at?: string;
  updated_at?: string;
}

export interface DownloadJob {
  id: number;
  pid: string;
  job_type: 'preview' | 'full' | 'backfill';
  requested_sizes: string[];
  status: 'pending' | 'running' | 'success' | 'failed';
  priority?: number;
  source_type?: string;
  source_key?: string;
  max_attempts?: number;
  attempt_count?: number;
  last_error?: string;
  started_at?: string;
  finished_at?: string;
  created_at?: string;
  updated_at?: string;
}

// ========================================
// 配置相关类型定义
// ========================================

export interface Config {
  pixiv_headers: PixivHeaders;
  ACGN_tags: Record<string, string[]>;
  blacklist_tag: string[];
  img_dirs: string;
  img_nums: number;
}

// ========================================
// 下载相关类型定义
// ========================================

export interface PixivIllustPage {
  urls: {
    original: string;
    regular: string;
    small: string;
    thumb_mini: string;
  };
}

export interface PixivIllustPagesResponse {
  body: PixivIllustPage[];
  error: boolean;
}

export interface DownloadResult {
  success: boolean;
  pid: string;
  imageUrl?: string;
  b2Path?: string;          // 改为 B2 路径
  fileSize?: number;
  error?: string;
  artistName?: string;
}

// B2存储配置（替代R2）
export interface B2Config {
  applicationKeyId: string;
  applicationKey: string;
  bucketName: string;
  bucketId: string;
  endpoint: string;
}

// 保留R2Config以兼容旧代码
export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  region: string;
}

// ========================================
// Turso/libSQL 数据库配置
// ========================================

export interface TursoConfig {
  url: string;              // 数据库 URL（本地 file: 或远程 libsql://）
  authToken?: string;      // 认证令牌（仅远程需要，本地 file: 模式可省略）
  syncUrl?: string;        // 远程嵌入式副本 URL（本地 file: 模式忽略）
}
