import axios, { AxiosInstance } from 'axios';
import { 
  PixivIllustInfo, 
  PixivRecommendResponse, 
  PixivUserRecommendResponse, 
  PixivHeaders,
  DatabasePic,
  PixivDailyRankResponse,
  PixivDailyRankItem
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

// 日志管理器接口
interface ILogManager {
  addLog(message: string, type: 'info' | 'error' | 'warning' | 'success', taskId?: string): void;
}

export class PixivCrawler {
  private initPid: string;
  private headers: PixivHeaders;
  private headersList: PixivHeaders[];
  private headerIndex: number;
  private supabase: SupabaseService;
  private httpClient: AxiosInstance;
  private logManager: ILogManager;
  private taskId: string;
  private popularityThreshold: number;

  /**
   * PixivCrawler构造函数
   * @param pid 起始插画ID
   * @param headersList Pixiv请求头列表
   * @param logManager 日志管理器
   * @param taskId 任务ID
   * @param popularityThreshold 热度阈值，默认为0.22
   */
  constructor(pid: string, headersList: PixivHeaders[], logManager: ILogManager, taskId: string, popularityThreshold: number = 0.22) {
    this.initPid = pid;
    this.headers = headersList[0];
    this.headersList = headersList;
    this.headerIndex = 0;
    this.supabase = new SupabaseService();
    this.logManager = logManager;
    this.taskId = taskId;
    this.popularityThreshold = popularityThreshold;
    
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
    this.logManager.addLog(`切换到p站headers第${this.headerIndex + 1}个`, 'info', this.taskId);
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
        this.logManager.addLog(`获取插画信息失败，错误json为${JSON.stringify(resJson)}`, 'warning', this.taskId);
        return null;
      }
    } catch (error) {
      this.logManager.addLog(`获取插画${pid}信息异常: ${error instanceof Error ? error.message : String(error)}`, 'error', this.taskId);
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
        this.logManager.addLog(`获取插画：${pid}推荐列表成功！`, 'info', this.taskId);
        return resJson;
      } else {
        this.logManager.addLog(`获取插画信息失败，错误json为${JSON.stringify(resJson)}`, 'warning', this.taskId);
        return null;
      }
    } catch (error) {
      this.logManager.addLog(`获取插画${pid}推荐异常: ${error instanceof Error ? error.message : String(error)}`, 'error', this.taskId);
      return null;
    }
  }
  async getDailyRank(authorId?: string): Promise<PixivDailyRankResponse | null> {
    try {
      const sleepTime = getRandomDelay(CRAWLER_CONFIG.REQUEST_DELAY_MIN, CRAWLER_CONFIG.REQUEST_DELAY_MAX);
      await sleep(sleepTime);
      const response = await this.httpClient.get(
        `https://www.pixiv.net/ranking.php?mode=daily&content=illust`,
        { responseType: 'text' }
      );
      this.logManager.addLog(`获取每日榜单成功，html为${response}`, 'info', this.taskId);

      const html: string = typeof response.data === 'string' ? response.data : String(response.data);
      // 提取形如 /artworks/123456789 的链接，捕获数字作为 pid
      const pidRegex = /<a\s+[^>]*href=["']\/artworks\/(\d+)["'][^>]*>/g;
      const pidToFirstRank = new Map<string, number>();
      let match: RegExpExecArray | null;
      let index = 0;
      while ((match = pidRegex.exec(html)) !== null) {
        const pid = match[1];
        if (!pidToFirstRank.has(pid)) {
          // 排名按首次出现顺序计算，从1开始
          pidToFirstRank.set(pid, index + 1);
        }
        index += 1;
        // 安全阈值，避免无意义地解析过多
        if (pidToFirstRank.size >= 200) {
          break;
        }
      }

      if (pidToFirstRank.size === 0) {
        this.logManager.addLog(`解析每日榜单页面失败，未发现任何PID`, 'warning', this.taskId);
        return { body: { rankings: [] }, error: false } as PixivDailyRankResponse;
      }

      const now = formatDateTime(new Date());
      const rankings: PixivDailyRankItem[] = Array.from(pidToFirstRank.entries())
        .sort((a, b) => a[1] - b[1])
        .map(([pid, rank]) => ({
          pid,
          rank,
          crawl_time: now
        }));

      this.logManager.addLog(`获取每日榜单成功，解析到 ${rankings.length} 个PID`, 'info', this.taskId);
      return {
        body: { rankings },
        error: false
      };
    } catch (error) {
      this.logManager.addLog(`获取每日榜单异常: ${error instanceof Error ? error.message : String(error)}`, 'error', this.taskId);
      return null;
    }
  }

  private async getRankByMode(mode: 'daily' | 'weekly' | 'monthly'): Promise<PixivDailyRankResponse | null> {
    try {
      const sleepTime = getRandomDelay(CRAWLER_CONFIG.REQUEST_DELAY_MIN, CRAWLER_CONFIG.REQUEST_DELAY_MAX);
      await sleep(sleepTime);

      const response = await this.httpClient.get(
        `https://www.pixiv.net/ranking.php?mode=${mode}&content=illust`,
        { responseType: 'text' }
      );

      const html: string = typeof response.data === 'string' ? response.data : String(response.data);
      const pidRegex = /<a\s+[^>]*href=["']\/artworks\/(\d+)["'][^>]*>/g;
      const pidToFirstRank = new Map<string, number>();
      let match: RegExpExecArray | null;
      let index = 0;
      while ((match = pidRegex.exec(html)) !== null) {
        const pid = match[1];
        if (!pidToFirstRank.has(pid)) {
          pidToFirstRank.set(pid, index + 1);
        }
        index += 1;
        if (pidToFirstRank.size >= 200) {
          break;
        }
      }

      if (pidToFirstRank.size === 0) {
        this.logManager.addLog(`解析${mode}榜单页面失败，未发现任何PID`, 'warning', this.taskId);
        return { body: { rankings: [] }, error: false } as PixivDailyRankResponse;
      }

      const now = formatDateTime(new Date());
      const rankings: PixivDailyRankItem[] = Array.from(pidToFirstRank.entries())
        .sort((a, b) => a[1] - b[1])
        .map(([pid, rank]) => ({ pid, rank, crawl_time: now }));

      this.logManager.addLog(`获取${mode}榜单成功，解析到 ${rankings.length} 个PID`, 'info', this.taskId);
      return { body: { rankings }, error: false };
    } catch (error) {
      this.logManager.addLog(`获取${mode}榜单异常: ${error instanceof Error ? error.message : String(error)}`, 'error', this.taskId);
      return null;
    }
  }

  async getWeeklyRank(): Promise<PixivDailyRankResponse | null> {
    return this.getRankByMode('weekly');
  }

  async getMonthlyRank(): Promise<PixivDailyRankResponse | null> {
    return this.getRankByMode('monthly');
  }

  async getAuthorRecommend(authorId: string): Promise<PixivUserRecommendResponse | null> {
    try {
      const response = await this.httpClient.get(
        `https://www.pixiv.net/ajax/user/${authorId}/recommends?userNum=30&workNum=5&isR18=false&lang=zh`
      );

      const resJson: PixivUserRecommendResponse = response.data;
      
      if (resJson.error === false) {
        this.logManager.addLog(`获取用户：${authorId}推荐列表成功！`, 'info', this.taskId);
        return resJson;
      } else {
        this.logManager.addLog(`获取author建议信息失败，错误json为${JSON.stringify(resJson)}`, 'warning', this.taskId);
        return null;
      }
    } catch (error) {
      this.logManager.addLog(`获取用户${authorId}推荐异常: ${error instanceof Error ? error.message : String(error)}`, 'error', this.taskId);
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
        this.logManager.addLog(`递归获取插画pid：${pid}出现异常：${error}，自动跳过`, 'warning', this.taskId);
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
      this.logManager.addLog(`递归获取图片推荐异常:${error}，已自动切换cookie`, 'warning', this.taskId);
      this.setNextHeader();
    }

    let popularityCount = 0;
    let failedCount = 0;
    let requestCount = 0;

    this.logManager.addLog(`已获取相关图片${firstPids.length}张`, 'info', this.taskId);

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

          if (roundedPopularity >= this.popularityThreshold) {
            const viewJson = getIllustData(info);
            if (viewJson) {
              const illustTags = getIllustTags(info);
              this.logManager.addLog(`view_json:${JSON.stringify(viewJson)}`, 'info', this.taskId);
              this.logManager.addLog(`tag:${JSON.stringify(illustTags)}`, 'info', this.taskId);

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
        // 解析错误信息，提供更友好的提示
        let errorMessage = '';
        let isDuplicate = false;
        
        if (error && typeof error === 'object') {
          // 检查是否是Supabase错误
          if ('code' in error && 'message' in error) {
            const supabaseError = error as any;
            if (supabaseError.code === '23505' || supabaseError.message?.includes('duplicate key')) {
              errorMessage = `PID:${firstPid} 已存在于数据库中，跳过重复插入`;
              isDuplicate = true;
            } else {
              errorMessage = `数据库错误: ${supabaseError.message || supabaseError.code}`;
            }
          } else if ('message' in error) {
            errorMessage = (error as Error).message;
          } else {
            errorMessage = JSON.stringify(error);
          }
        } else {
          errorMessage = String(error);
        }
        
        if (isDuplicate) {
          this.logManager.addLog(errorMessage, 'info', this.taskId);
        } else {
          failedCount++;
          this.logManager.addLog(`处理PID:${firstPid}异常: ${errorMessage}，已自动跳过`, 'warning', this.taskId);
        }
      }
    }

    const endTime = Date.now();
    const elapsedTime = (endTime - startTime) / 1000;
    
    // 详细的统计信息
    const totalProcessed = firstPids.length;
    const successRate = ((totalProcessed - failedCount) / totalProcessed * 100).toFixed(1);
    const popularityRate = (popularityCount / totalProcessed * 100).toFixed(1);
    
    this.logManager.addLog(`处理完成，耗时：${elapsedTime.toFixed(2)}秒，本次新增${popularityCount}张图片，写入数据库失败图片${failedCount}张，热门图片比例为${popularityRate}%`, 'info', this.taskId);
    
    // 添加详细的爬取完成总结
    this.logManager.addLog(`📊 爬取任务完成统计：`, 'success', this.taskId);
    this.logManager.addLog(`🎯 目标数量: ${targetNum} 张`, 'success', this.taskId);
    this.logManager.addLog(`📥 实际获取: ${totalProcessed} 张相关图片`, 'success', this.taskId);
    this.logManager.addLog(`✅ 符合热度阈值(≥${this.popularityThreshold}): ${popularityCount} 张`, 'success', this.taskId);
    this.logManager.addLog(`❌ 处理失败: ${failedCount} 张`, failedCount > 0 ? 'warning' : 'success', this.taskId);
    this.logManager.addLog(`📈 成功率: ${successRate}%`, 'success', this.taskId);
    this.logManager.addLog(`🔥 热门图片比例: ${popularityRate}%`, 'success', this.taskId);
    this.logManager.addLog(`⏱️ 总耗时: ${elapsedTime.toFixed(2)} 秒`, 'success', this.taskId);
    this.logManager.addLog(`🎉 爬取完成！`, 'success', this.taskId);
  }
}