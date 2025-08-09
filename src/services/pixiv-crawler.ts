import axios, { AxiosInstance } from 'axios';
import { 
  PixivIllustInfo, 
  PixivRecommendResponse, 
  PixivUserRecommendResponse, 
  PixivHeaders,
  DatabasePic 
} from '../types';
import { SupabaseService } from '../database/supabase';
import { 
  getIllustUser, 
  getIllustTags, 
  getIllustRecommendPids, 
  getAuthorRecommendUsers, 
  getAuthorRecommendPids,
  getIllustPopularity,
  getIllustData,
  sleep,
  getRandomDelay,
  formatDateTime
} from '../utils/pixiv-utils';
import { CRAWLER_CONFIG } from '../config';

export class PixivCrawler {
  private initPid: string;
  private headers: PixivHeaders;
  private headersList: PixivHeaders[];
  private headerIndex: number;
  private supabase: SupabaseService;
  private httpClient: AxiosInstance;

  constructor(pid: string, headersList: PixivHeaders[]) {
    this.initPid = pid;
    this.headers = headersList[0];
    this.headersList = headersList;
    this.headerIndex = 0;
    this.supabase = new SupabaseService();
    
    this.httpClient = axios.create({
      timeout: 30000,
      headers: this.headers as any
    });
  }

  private setNextHeader(): void {
    const lenHeadersList = this.headersList.length;
    this.headerIndex = (this.headerIndex + 1) % lenHeadersList;
    this.headers = this.headersList[this.headerIndex];
    this.httpClient.defaults.headers = this.headers as any;
    console.log(`切换到p站headers第${this.headerIndex + 1}个`);
  }

  async getIllustInfo(pid: string): Promise<PixivIllustInfo | null> {
    try {
      // 随机延迟防止被ban
      const sleepTime = getRandomDelay(CRAWLER_CONFIG.REQUEST_DELAY_MIN, CRAWLER_CONFIG.REQUEST_DELAY_MAX);
      await sleep(sleepTime);

      const response = await this.httpClient.get(
        `https://www.pixiv.net/ajax/illust/${pid}`
      );

      const resJson: PixivIllustInfo = response.data;
      
      if (resJson.error === false) {
        return resJson;
      } else {
        console.log(`获取插画信息失败，错误json为${JSON.stringify(resJson)}`);
        return null;
      }
    } catch (error) {
      console.error(`获取插画${pid}信息异常:`, error);
      return null;
    }
  }

  async getIllustRecommend(pid: string): Promise<PixivRecommendResponse | null> {
    try {
      const response = await this.httpClient.get(
        `https://www.pixiv.net/ajax/illust/${pid}/recommend/init?limit=30&lang=zh`
      );

      const resJson: PixivRecommendResponse = response.data;
      
      if (resJson.error === false) {
        console.log(`获取插画：${pid}推荐列表成功！`);
        return resJson;
      } else {
        console.log(`获取插画信息失败，错误json为${JSON.stringify(resJson)}`);
        return null;
      }
    } catch (error) {
      console.error(`获取插画${pid}推荐异常:`, error);
      return null;
    }
  }

  async getAuthorRecommend(authorId: string): Promise<PixivUserRecommendResponse | null> {
    try {
      const response = await this.httpClient.get(
        `https://www.pixiv.net/ajax/user/${authorId}/recommends?userNum=30&workNum=5&isR18=false&lang=zh`
      );

      const resJson: PixivUserRecommendResponse = response.data;
      
      if (resJson.error === false) {
        console.log(`获取用户：${authorId}推荐列表成功！`);
        return resJson;
      } else {
        console.log(`获取author建议信息失败，错误json为${JSON.stringify(resJson)}`);
        return null;
      }
    } catch (error) {
      console.error(`获取用户${authorId}推荐异常:`, error);
      return null;
    }
  }

  private async reGetAuthor(userIds: string[], targetNum: number): Promise<string[]> {
    if (userIds.length >= targetNum) {
      return userIds;
    }

    for (const user of userIds) {
      const resJson = await this.getAuthorRecommend(user);
      if (resJson) {
        const addUserIds = getAuthorRecommendPids(resJson as any);
        userIds.push(...addUserIds);
        
        if (userIds.length >= targetNum) {
          return userIds;
        }
      }
    }

    return this.reGetAuthor(userIds, targetNum);
  }

  private async reGetIllust(pids: string[], targetNum: number): Promise<string[]> {
    if (pids.length >= targetNum) {
      return pids;
    }

    const seenPids = new Set(pids); // 使用集合避免重复

    for (const pid of pids) {
      try {
        const resJson = await this.getIllustRecommend(pid);
        if (resJson) {
          const illustInfo = await this.getIllustInfo(pid);
          if (illustInfo) {
            const userId = getIllustUser(illustInfo);
            if (userId) {
              const userRecommendJson = await this.getAuthorRecommend(userId);
              if (userRecommendJson) {
                const userRecommendPidList = getAuthorRecommendPids(userRecommendJson as any);
                const addPids = getIllustRecommendPids(resJson as any);
                addPids.push(...userRecommendPidList);

                for (const newPid of addPids) {
                  if (!seenPids.has(newPid)) {
                    pids.push(newPid);
                    seenPids.add(newPid);
                  }
                }

                if (pids.length >= targetNum) {
                  return pids;
                }
              }
            }
          }
        }
      } catch (error) {
        console.log(`递归获取插画pid：${pid}出现异常：${error}，自动跳过`);
        continue;
      }
    }

    return this.reGetIllust(pids, targetNum);
  }

  async getPidsFilterByTags(tags: string[], pids: string[]): Promise<string[]> {
    const resPids: string[] = [];
    
    for (const pid of pids) {
      const info = await this.getIllustInfo(pid);
      if (info) {
        const pidTags = getIllustTags(info);
        if (tags.every(tag => pidTags.includes(tag))) {
          resPids.push(pid);
        }
      }
    }
    
    return resPids;
  }

  // 根据起始pid获取推荐的pid，并且写入数据库
  async getPidsFromOriginPid(pid: string, targetNum: number = CRAWLER_CONFIG.MAX_ILLUSTRATIONS): Promise<void> {
    const startTime = Date.now();
    let firstPids = [pid];

    try {
      firstPids = await this.reGetIllust([pid], targetNum);
    } catch (error) {
      console.log(`递归获取图片推荐异常:${error}，已自动切换cookie`);
      this.setNextHeader();
    }

    let popularityCount = 0;
    let failedCount = 0;
    let requestCount = 0;

    console.log(`已获取相关图片${firstPids.length}张`);

    for (const firstPid of firstPids) {
      try {
        // 每请求300次换1个cookie
        if ((requestCount % CRAWLER_CONFIG.MAX_REQUESTS_PER_HEADER) === CRAWLER_CONFIG.MAX_REQUESTS_PER_HEADER - 1) {
          this.setNextHeader();
        }

        const info = await this.getIllustInfo(firstPid);
        requestCount++;

        if (info) {
          const popularity = getIllustPopularity(info);
          const roundedPopularity = Math.round(popularity * 100) / 100;

          if (roundedPopularity >= CRAWLER_CONFIG.POPULARITY_THRESHOLD) {
            const viewJson = getIllustData(info);
            if (viewJson) {
              const illustTags = getIllustTags(info);
              console.log(`view_json:${JSON.stringify(viewJson)}`);
              console.log(`tag:${JSON.stringify(illustTags)}`);

              const now = formatDateTime(new Date());
              const tagsString = illustTags.join(', ');

              const picData: DatabasePic = {
                pid: firstPid,
                download_time: now,
                tag: tagsString,
                good: viewJson.like,
                star: viewJson.bookmark,
                view: viewJson.view,
                image_path: '',
                image_url: '',
                popularity: roundedPopularity
              };

              await this.supabase.createPic(picData);
              popularityCount++;
            }
          }
        }
      } catch (error) {
        failedCount++;
        console.log(`处理pid:${firstPid}处理异常:${error}，已自动跳过`);
      }
    }

    const endTime = Date.now();
    const elapsedTime = (endTime - startTime) / 1000;
    
    console.log(`处理完成，耗时：${elapsedTime.toFixed(2)}秒，本次新增${popularityCount}张图片，写入数据库失败图片${failedCount}张，热门图片比例为${popularityCount / firstPids.length}`);
  }
} 