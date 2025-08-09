import dotenv from 'dotenv';
import { Config, PixivHeaders } from '../types';

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

export const CRAWLER_CONFIG = {
  MAX_ILLUSTRATIONS: parseInt(process.env.MAX_ILLUSTRATIONS || '1000'),
  POPULARITY_THRESHOLD: parseFloat(process.env.POPULARITY_THRESHOLD || '0.22'),
  REQUEST_DELAY_MIN: parseInt(process.env.REQUEST_DELAY_MIN || '0'),
  REQUEST_DELAY_MAX: parseInt(process.env.REQUEST_DELAY_MAX || '1000'),
  MAX_REQUESTS_PER_HEADER: parseInt(process.env.MAX_REQUESTS_PER_HEADER || '300')
};

export const getPixivHeaders = (): PixivHeaders[] => {
  // 这里可以配置多个headers来轮换使用，避免被ban
  return [
    {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
      cookie: process.env.PIXIV_COOKIE || '',
      Referer: 'https://www.pixiv.net/artworks/122971002',
      'Accept-Language': 'zh-CN,zh;q=0.8,zh-TW;q=0.2'
    }
  ];
}; 