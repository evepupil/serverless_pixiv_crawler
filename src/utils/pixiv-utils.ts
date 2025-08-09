import { PixivIllustInfo, IllustData } from '../types';

export function getIllustUser(infoJson: PixivIllustInfo): string | null {
  if (typeof infoJson.body === 'object' && infoJson.body.userId) {
    return infoJson.body.userId;
  }
  return null;
}

export function getIllustTags(infoJson: PixivIllustInfo): string[] {
  const tagsList: string[] = [];
  
  if (typeof infoJson.body === 'object' && infoJson.body.tags?.tags) {
    for (const tag of infoJson.body.tags.tags) {
      if (tag.translation?.en) {
        tagsList.push(tag.translation.en);
      }
      tagsList.push(tag.tag);
    }
  }
  
  return tagsList;
}

export function getIllustRecommendPids(infoJson: PixivIllustInfo): string[] {
  const pids: string[] = [];
  
  if (typeof infoJson.body === 'object' && infoJson.body.illusts) {
    for (const illust of infoJson.body.illusts) {
      pids.push(illust.id);
    }
  }
  
  return pids;
}

export function getAuthorRecommendUsers(infoJson: PixivIllustInfo): string[] {
  const userIds: string[] = [];
  
  if (typeof infoJson.body === 'object' && infoJson.body.recommendUsers) {
    for (const user of infoJson.body.recommendUsers) {
      userIds.push(user.userId);
    }
  }
  
  return userIds;
}

export function getAuthorRecommendPids(infoJson: PixivIllustInfo): string[] {
  const pids: string[] = [];
  
  if (typeof infoJson.body === 'object' && infoJson.body.recommendUsers) {
    for (const user of infoJson.body.recommendUsers) {
      pids.push(...user.illustIds);
    }
  }
  
  return pids;
}

// 计算是否热门
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
    
    let popularity = (like * 0.55 + bookmark * 0.45) / view;
    
    if (view < 5000) {
      popularity = popularity * (view / 5000);
    }
    
    return popularity;
  }
  
  return 0;
}

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

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function getRandomDelay(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

export function formatDateTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
} 