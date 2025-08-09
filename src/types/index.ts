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
  download_time: string;
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
}

export interface Config {
  pixiv_headers: PixivHeaders;
  ACGN_tags: Record<string, string[]>;
  blacklist_tag: string[];
  img_dirs: string;
  img_nums: number;
} 