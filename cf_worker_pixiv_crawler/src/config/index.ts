// 配置服务 - CF Worker 版本
// 复用 Vercel 版本的配置逻辑

export function getPixivHeaders(): any[] {
  // 返回默认的请求头配置
  return [{
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
  }];
}

export const CRAWLER_CONFIG = {
  MAX_ILLUSTRATIONS: 1000,
  POPULARITY_THRESHOLD: 0.22,
  REQUEST_DELAY_MIN: 0,
  REQUEST_DELAY_MAX: 1000,
  MAX_REQUESTS_PER_HEADER: 300
}; 