// 复用 Vercel 版本的类型定义

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

export interface DatabasePic {
  pid: string;
  download_time?: string;
  tag?: string;
  good?: number;
  star?: number;
  view?: number;
  image_path?: string;
  image_url?: string;
  popularity?: number;
  upload_time?: string;
  wx_url?: string;
  wx_name?: string;
  unfit?: boolean;
  created_at?: string;
  updated_at?: string;
} 