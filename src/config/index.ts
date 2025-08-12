import dotenv from 'dotenv';
import { Config, PixivHeaders, R2Config } from '../types';

dotenv.config();

export const config: Config = {
  
  pixiv_headers: {
    'User-Agent': process.env.PIXIV_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
    cookie: process.env.PIXIV_COOKIE || '',
    Referer: process.env.PIXIV_REFERER || 'https://www.pixiv.net/artworks/112388359',
    'Accept-Language': 'zh-CN,zh;q=0.8,zh-TW;q=0.2'
  },
  ACGN_tags: {
    "原神": ["Genshin Impact", "GenshinImpact", "Genshin"],
    "碧蓝档案": [],
    "原创": []
  },
  blacklist_tag: ["AI 作画", "R-18", "比基尼", "肚脐", "裸下半身", "屁股"],
  img_dirs: "artworks_IMG/img_dirs",
  img_nums: 10
};

// 爬虫配置
export const CRAWLER_CONFIG = {
  MAX_ILLUSTRATIONS: 1000,
  MAX_REQUESTS_PER_HEADER: 300,
  // 减少延迟以提高速度
  REQUEST_DELAY_MIN: 100,  // 从1000ms减少到100ms
  REQUEST_DELAY_MAX: 500,  // 从3000ms减少到500ms
  // 新增并发控制
  CONCURRENT_REQUESTS: 3,  // 并发请求数
  BATCH_SIZE: 10,          // 批量处理大小
  // 超时优化
  HTTP_TIMEOUT: 15000,     // 从30秒减少到15秒
  // 重试机制
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000
};

// 获取Pixiv请求头列表
export function getPixivHeaders(): PixivHeaders[] {
  const cookie = process.env.PIXIV_COOKIE;
  
  if (!cookie || cookie === 'your_pixiv_cookie_here') {
    throw new Error('PIXIV_COOKIE 环境变量未设置或使用默认值');
  }

  // 基础请求头
  const baseHeaders: PixivHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'cookie': cookie,
    'Referer': 'https://www.pixiv.net/',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin'
  };

  // 如果配置了多个cookie，可以分割成多个请求头
  const cookies = cookie.split(';').map(c => c.trim());
  if (cookies.length > 1) {
    return cookies.map(c => ({
      ...baseHeaders,
      'cookie': c
    }));
  }

  return [baseHeaders];
}

// 获取R2配置
export function getR2Config(): R2Config {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const accessKeyId = process.env.CLOUDFLARE_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CLOUDFLARE_SECRET_ACCESS_KEY;
  const bucketName = process.env.CLOUDFLARE_BUCKET_NAME;
  const region = process.env.CLOUDFLARE_REGION || 'auto';

  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    throw new Error('Cloudflare R2 环境变量未完整配置，需要: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_ACCESS_KEY_ID, CLOUDFLARE_SECRET_ACCESS_KEY, CLOUDFLARE_BUCKET_NAME');
  }

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketName,
    region
  };
}

// 检查环境变量配置
export function checkEnvironmentVariables(): { valid: boolean; missing: string[] } {
  const required = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'PIXIV_COOKIE'
  ];

  const optional = [
    'CLOUDFLARE_ACCOUNT_ID',
    'CLOUDFLARE_ACCESS_KEY_ID',
    'CLOUDFLARE_SECRET_ACCESS_KEY',
    'CLOUDFLARE_BUCKET_NAME'
  ];

  const missing: string[] = [];
  
  // 检查必需的环境变量
  for (const envVar of required) {
    const value = process.env[envVar];
    if (!value || value === `your_${envVar.toLowerCase()}_here`) {
      missing.push(envVar);
    }
  }

  return {
    valid: missing.length === 0,
    missing
  };
}

// 检查R2配置是否完整
export function checkR2Config(): { valid: boolean; missing: string[] } {
  const r2Required = [
    'CLOUDFLARE_ACCOUNT_ID',
    'CLOUDFLARE_ACCESS_KEY_ID',
    'CLOUDFLARE_SECRET_ACCESS_KEY',
    'CLOUDFLARE_BUCKET_NAME'
  ];

  const missing: string[] = [];
  
  for (const envVar of r2Required) {
    const value = process.env[envVar];
    if (!value || value === `your_${envVar.toLowerCase()}_here`) {
      missing.push(envVar);
    }
  }

  return {
    valid: missing.length === 0,
    missing
  };
} 