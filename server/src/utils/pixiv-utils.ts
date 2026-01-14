import { PixivIllustInfo, IllustData } from '../types';

// ========================================
// Pixiv 数据提取工具函数
// ========================================

/**
 * 获取插画作者ID
 * @param infoJson Pixiv插画信息
 * @returns 作者ID或null
 */
export function getIllustUser(infoJson: PixivIllustInfo): string | null {
  if (typeof infoJson.body === 'object' && infoJson.body.userId) {
    return infoJson.body.userId;
  }
  return null;
}

/**
 * 获取插画标签列表
 * @param infoJson Pixiv插画信息
 * @returns 标签数组
 */
export function getIllustTags(infoJson: PixivIllustInfo): string[] {
  const tagsList: string[] = [];

  if (typeof infoJson.body === 'object' && infoJson.body.tags?.tags) {
    for (const tag of infoJson.body.tags.tags) {
      // 添加英文翻译（如果有）
      if (tag.translation?.en) {
        tagsList.push(tag.translation.en);
      }
      // 添加原始标签
      tagsList.push(tag.tag);
    }
  }

  return tagsList;
}

/**
 * 从插画信息中获取推荐PID列表
 * @param infoJson Pixiv插画信息
 * @returns PID数组
 */
export function getIllustRecommendPids(infoJson: PixivIllustInfo): string[] {
  const pids: string[] = [];

  if (typeof infoJson.body === 'object' && infoJson.body.illusts) {
    for (const illust of infoJson.body.illusts) {
      pids.push(illust.id);
    }
  }

  return pids;
}

/**
 * 从推荐响应中提取插画PID列表
 * @param recommendResponse 推荐响应数据
 * @returns 插画PID数组
 */
export function getRecommendPidsFromResponse(recommendResponse: any): string[] {
  const pids: string[] = [];

  if (typeof recommendResponse === 'object' &&
      recommendResponse.body &&
      Array.isArray(recommendResponse.body.illusts)) {
    for (const illust of recommendResponse.body.illusts) {
      if (illust && illust.id) {
        pids.push(illust.id);
      }
    }
  }

  return pids;
}

/**
 * 获取作者推荐的用户ID列表
 * @param infoJson Pixiv插画信息
 * @returns 用户ID数组
 */
export function getAuthorRecommendUsers(infoJson: PixivIllustInfo): string[] {
  const userIds: string[] = [];

  if (typeof infoJson.body === 'object' && infoJson.body.recommendUsers) {
    for (const user of infoJson.body.recommendUsers) {
      userIds.push(user.userId);
    }
  }

  return userIds;
}

/**
 * 获取作者推荐的PID列表
 * @param infoJson Pixiv插画信息
 * @returns PID数组
 */
export function getAuthorRecommendPids(infoJson: PixivIllustInfo): string[] {
  const pids: string[] = [];

  if (typeof infoJson.body === 'object' && infoJson.body.recommendUsers) {
    for (const user of infoJson.body.recommendUsers) {
      pids.push(...user.illustIds);
    }
  }

  return pids;
}

// ========================================
// 热度计算
// ========================================

/**
 * 计算插画热度
 * 公式: (点赞数 × 0.55 + 收藏数 × 0.45) ÷ 浏览量
 * 低浏览量惩罚: 浏览量 < 5000 时，热度按比例降低
 * @param infoJson Pixiv插画信息
 * @returns 热度值
 */
export function getIllustPopularity(infoJson: PixivIllustInfo): number {
  if (Array.isArray(infoJson.body)) {
    return 0;
  }

  if (typeof infoJson.body === 'object' &&
      'likeCount' in infoJson.body &&
      'bookmarkCount' in infoJson.body &&
      'viewCount' in infoJson.body) {

    const like = infoJson.body.likeCount;
    const bookmark = infoJson.body.bookmarkCount;
    const view = infoJson.body.viewCount;

    // 基础热度计算
    let popularity = (like * 0.55 + bookmark * 0.45) / view;

    // 低浏览量惩罚机制
    if (view < 5000) {
      popularity = popularity * (view / 5000);
    }

    return popularity;
  }

  return 0;
}

/**
 * 获取插画交互数据
 * @param infoJson Pixiv插画信息
 * @returns 交互数据对象或null
 */
export function getIllustData(infoJson: PixivIllustInfo): IllustData | null {
  if (Array.isArray(infoJson.body)) {
    return null;
  }

  if (typeof infoJson.body === 'object' &&
      'likeCount' in infoJson.body &&
      'bookmarkCount' in infoJson.body &&
      'viewCount' in infoJson.body) {

    const like = infoJson.body.likeCount;
    const bookmark = infoJson.body.bookmarkCount;
    const view = infoJson.body.viewCount;

    return {
      like,
      bookmark,
      view
    };
  }

  return null;
}

// ========================================
// 元数据提取
// ========================================

/**
 * 获取插画标题
 * @param infoJson Pixiv插画信息
 * @returns 标题或null
 */
export function getIllustTitle(infoJson: PixivIllustInfo): string | null {
  if (typeof infoJson.body === 'object' && infoJson.body.title) {
    return infoJson.body.title;
  }
  return null;
}

/**
 * 获取作者ID
 * @param infoJson Pixiv插画信息
 * @returns 作者ID或null
 */
export function getIllustAuthorId(infoJson: PixivIllustInfo): string | null {
  if (typeof infoJson.body === 'object' && infoJson.body.userId) {
    return infoJson.body.userId;
  }
  return null;
}

/**
 * 获取作者名称
 * @param infoJson Pixiv插画信息
 * @returns 作者名称或null
 */
export function getIllustAuthorName(infoJson: PixivIllustInfo): string | null {
  if (typeof infoJson.body === 'object' && infoJson.body.userName) {
    return infoJson.body.userName;
  }
  return null;
}

// ========================================
// 通用工具函数
// ========================================

/**
 * 延迟执行
 * @param ms 延迟毫秒数
 * @returns Promise
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 获取随机延迟时间
 * @param min 最小延迟毫秒数
 * @param max 最大延迟毫秒数
 * @returns 随机延迟毫秒数
 */
export function getRandomDelay(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

/**
 * 格式化日期时间
 * @param date 日期对象
 * @returns 格式化后的字符串 (YYYY-MM-DD HH:mm:ss)
 */
export function formatDateTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}
