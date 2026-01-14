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
  title?: string;           // 插画标题
  author_id?: string;       // 作者ID
  author_name?: string;     // 作者名称
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
  size?: number;            // 图片文件大小（字节）
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
  url: string;              // Turso 数据库 URL
  authToken: string;        // 认证令牌
  syncUrl?: string;         // 本地同步 URL (用于 Local Read Replica)
}
