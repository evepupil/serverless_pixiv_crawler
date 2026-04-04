import dotenv from 'dotenv';
import { Config, PixivHeaders, B2Config, TursoConfig } from '../types';

// 加载环境变量
dotenv.config();

// ========================================
// 基础配置
// ========================================

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
  blacklist_tag: ["AI art", "R-18", "bikini", "underboob", "lower body", "hips"],
  img_dirs: "artworks_IMG/img_dirs",
  img_nums: 10
};

// ========================================
// 爬虫配置 - 针对东京服务器优化
// ========================================

export const CRAWLER_CONFIG = {
  MAX_ILLUSTRATIONS: 1000,
  MAX_REQUESTS_PER_HEADER: 300,
  // 东京服务器延迟更低，可以更快
  REQUEST_DELAY_MIN: 50,    // 从100ms减少到50ms
  REQUEST_DELAY_MAX: 300,   // 从500ms减少到300ms
  // 并发控制 - 东京服务器可以更高
  CONCURRENT_REQUESTS: 5,   // 从3增加到5
  BATCH_SIZE: 20,           // 从10增加到20
  // 超时优化
  HTTP_TIMEOUT: 10000,      // 从15秒减少到10秒
  // 重试机制
  MAX_RETRIES: 3,
  RETRY_DELAY: 500          // 从1000ms减少到500ms
};

// ========================================
// Pixiv请求头
// ========================================

/**
 * 获取Pixiv请求头列表
 * @returns PixivHeaders[] 请求头数组
 */
export function getPixivHeaders(): PixivHeaders[] {
  const cookie = process.env.PIXIV_COOKIE;

  if (!cookie || cookie === 'your_pixiv_cookie_here') {
    throw new Error('PIXIV_COOKIE is not configured');
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

  return [baseHeaders];
}

// ========================================
// Turso 数据库配置
// ========================================

/**
 * 获取Turso数据库配置
 * @returns TursoConfig Turso配置对象
 */
export function getTursoConfig(): TursoConfig {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  const syncUrl = process.env.TURSO_SYNC_URL; // 本地同步 URL（可选）

  if (!url || !authToken) {
    throw new Error('Turso 环境变量未完整配置，需要: TURSO_DATABASE_URL, TURSO_AUTH_TOKEN');
  }

  return {
    url,
    authToken,
    syncUrl
  };
}

// ========================================
// B2 存储配置
// ========================================

/**
 * 获取B2存储配置
 * @returns B2Config B2配置对象
 */
export function getB2Config(): B2Config {
  const applicationKeyId = process.env.B2_APPLICATION_KEY_ID;
  const applicationKey = process.env.B2_APPLICATION_KEY;
  const bucketName = process.env.B2_BUCKET_NAME;
  const bucketId = process.env.B2_BUCKET_ID;
  const endpoint = process.env.B2_ENDPOINT || 's3.us-west-004.backblazeb2.com';

  if (!applicationKeyId || !applicationKey || !bucketName || !bucketId) {
    throw new Error('B2 环境变量未完整配置，需要: B2_APPLICATION_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET_NAME, B2_BUCKET_ID');
  }

  return {
    applicationKeyId,
    applicationKey,
    bucketName,
    bucketId,
    endpoint
  };
}

// ========================================
// 环境变量检查
// ========================================

/**
 * 检查必需的环境变量配置
 * @returns { valid: boolean; missing: string[] }
 */
export function checkEnvironmentVariables(): { valid: boolean; missing: string[] } {
  const required = [
    'TURSO_DATABASE_URL',
    'TURSO_AUTH_TOKEN',
    'PIXIV_COOKIE'
  ];

  const missing: string[] = [];

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

/**
 * 检查B2配置是否完整
 * @returns { valid: boolean; missing: string[] }
 */
export function checkB2Config(): { valid: boolean; missing: string[] } {
  const b2Required = [
    'B2_APPLICATION_KEY_ID',
    'B2_APPLICATION_KEY',
    'B2_BUCKET_NAME',
    'B2_BUCKET_ID'
  ];

  const missing: string[] = [];

  for (const envVar of b2Required) {
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
