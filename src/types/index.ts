export interface PixivIllustInfo {
  body: {
    userId: string;
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

export interface DatabasePic {
  pid: string;
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
  size?: number; // 图片文件大小（字节）
}

export interface Config {
  pixiv_headers: PixivHeaders;
  ACGN_tags: Record<string, string[]>;
  blacklist_tag: string[];
  img_dirs: string;
  img_nums: number;
}

// 新增下载相关类型
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
  r2Path?: string;
  fileSize?: number;
  error?: string;
  artistName?: string;
}

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  region: string;
} 