import axios, { AxiosInstance } from 'axios';
import {
  PixivIllustInfo,
  PixivIllustResult,
  PixivRecommendResponse,
  PixivUserRecommendResponse,
  PixivDailyRankResponse,
  PixivRankingJsonResponse,
  DatabasePic,
  PixivDailyRankItem,
  PixivHeaders
} from '../types';
import { SupabaseService } from '../database/supabase';
import {
  getIllustUser,
  getIllustTags,
  getIllustRecommendPids,
  getRecommendPidsFromResponse,
  getAuthorRecommendUsers,
  getAuthorRecommendPids,
  getIllustPopularity,
  getIllustData,
  getIllustTitle,
  getIllustAuthorId,
  getIllustAuthorName,
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
   * @param popularityThreshold 热度阈值，默认为0
   */
  constructor(pid: string, headersList: PixivHeaders[], logManager: ILogManager, taskId: string, popularityThreshold: number =0) {
    this.initPid = pid;
    this.headers = headersList[0];
    this.headersList = headersList;
    this.headerIndex = 0;
    this.supabase = new SupabaseService();
    this.logManager = logManager;
    this.taskId = taskId;
    this.popularityThreshold = popularityThreshold;

    this.httpClient = axios.create({
      timeout: CRAWLER_CONFIG.HTTP_TIMEOUT, // 使用配置的超时时间
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

  async getIllustInfo(pid: string): Promise<PixivIllustResult | null> {
    let retries = 0;
    const maxRetries = CRAWLER_CONFIG.MAX_RETRIES;

    while (retries <= maxRetries) {
      try {
        // 减少延迟以提高速度
        if (retries > 0) {
          const sleepTime = CRAWLER_CONFIG.RETRY_DELAY * retries;
          await sleep(sleepTime);
        } else {
          const sleepTime = getRandomDelay(CRAWLER_CONFIG.REQUEST_DELAY_MIN, CRAWLER_CONFIG.REQUEST_DELAY_MAX);
          await sleep(sleepTime);
        }

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
        retries++;

        // 检查是否是 404 错误（图片不存在）
        if (error && typeof error === 'object' && 'response' in error) {
          const axiosError = error as any;
          if (axiosError.response && axiosError.response.status === 404) {
            this.logManager.addLog(`插画${pid}不存在（404错误），图片可能已被删除`, 'warning', this.taskId);
            // 返回特殊标记表示 404 错误
            return { error: true, status: 404, message: 'Image not found' };
          }
        }

        if (retries > maxRetries) {
          this.logManager.addLog(`获取插画${pid}信息异常(重试${maxRetries}次后失败): ${error instanceof Error ? error.message : String(error)}`, 'error', this.taskId);
          return null;
        }
        this.logManager.addLog(`获取插画${pid}信息异常，请求链接：https://www.pixiv.net/ajax/illust/${pid}，第${retries}次重试: ${error instanceof Error ? error.message : String(error)}`, 'warning', this.taskId);
      }
    }

    return null;
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

  // 获取首页推荐中的 PID（从根页面提取 data-gtm-work-id）
  async getHomeRecommendedPids(): Promise<string[] | null> {
    try {
      const sleepTime = getRandomDelay(CRAWLER_CONFIG.REQUEST_DELAY_MIN, CRAWLER_CONFIG.REQUEST_DELAY_MAX);
      await sleep(sleepTime);

      const response = await this.httpClient.get('https://www.pixiv.net/', { responseType: 'text' });
      const html: string = typeof response.data === 'string' ? response.data : String(response.data);
      this.logManager.addLog(`获取首页推荐成功，html长度为${html.length}`, 'info', this.taskId);

      // 查找"推荐作品"字符串的位置
      const recommendIndex = html.indexOf('推荐作品');
      if (recommendIndex === -1) {
        this.logManager.addLog(`未找到"推荐作品"字符串`, 'warning', this.taskId);
        return [];
      }

      // 从"推荐作品"之后开始提取HTML内容
      const htmlAfterRecommend = html.substring(recommendIndex);
      this.logManager.addLog(`从"推荐作品"之后开始匹配，剩余HTML长度: ${htmlAfterRecommend.length}`, 'info', this.taskId);

      // 提取形如 data-gtm-work-id="123456789" 的PID
      const pidRegex = /data-gtm-work-id=["'](\d+)["']/gi;
      const pids: string[] = [];
      const seen = new Set<string>();
      let match: RegExpExecArray | null;
      
      while ((match = pidRegex.exec(htmlAfterRecommend)) !== null) {
        const pid = match[1];
        if (!seen.has(pid)) {
          seen.add(pid);
          pids.push(pid);
          if (pids.length >= 500) break; // 合理阈值
        }
      }

      this.logManager.addLog(`首页推荐提取到 ${pids.length} 个唯一PID`, 'info', this.taskId);
      return pids;
    } catch (error) {
      this.logManager.addLog(`获取首页推荐异常: ${error instanceof Error ? error.message : String(error)}`, 'error', this.taskId);
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

      // 使用 JSON API，p=1 已包含50条数据
      const response = await this.httpClient.get(
        `https://www.pixiv.net/ranking.php?mode=${mode}&content=illust&format=json&p=1`
      );

      const jsonData: PixivRankingJsonResponse = response.data;

      if (!jsonData.contents || jsonData.contents.length === 0) {
        this.logManager.addLog(`${mode}榜单返回数据为空`, 'warning', this.taskId);
        return { body: { rankings: [] }, error: false } as PixivDailyRankResponse;
      }

      const now = formatDateTime(new Date());
      const rankings: PixivDailyRankItem[] = jsonData.contents.map(item => ({
        pid: String(item.illust_id),
        rank: item.rank,
        crawl_time: now
      }));

      this.logManager.addLog(`获取${mode}榜单成功，共 ${rankings.length} 个PID`, 'info', this.taskId);
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
      this.logManager.addLog(`获取用户：${authorId}推荐列表，url为https://www.pixiv.net/ajax/user/${authorId}/recommends?userNum=30&workNum=5&isR18=false&lang=zh`, 'info', this.taskId);
      this.logManager.addLog(`获取用户：${authorId}推荐列表，headers为${JSON.stringify(this.headers)}`, 'info', this.taskId);
      const response = await this.httpClient.get(
        `https://www.pixiv.net/ajax/user/${authorId}/recommends?userNum=30&workNum=5&isR18=false&lang=zh`
      );
      const resJson: PixivUserRecommendResponse = response.data;
      this.logManager.addLog(`获取用户：${authorId}推荐列表，原始json为${JSON.stringify(resJson)}`, 'info', this.taskId);

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

  /**
   * 递归获取作者推荐，带有深度限制和错误处理
   * @param userIds 用户ID列表
   * @param targetNum 目标数量
   * @param depth 当前递归深度
   * @param maxDepth 最大递归深度
   * @param errorCount 连续错误计数
   * @param maxErrors 最大连续错误数
   */
  private async reGetAuthor(
    userIds: string[],
    targetNum: number,
    depth: number = 0,
    maxDepth: number = 5,
    errorCount: number = 0,
    maxErrors: number = 10
  ): Promise<string[]> {
    // 检查是否达到目标数量
    if (userIds.length >= targetNum) {
      return userIds;
    }

    // 检查递归深度限制
    if (depth >= maxDepth) {
      this.logManager.addLog(`递归获取作者推荐达到最大深度限制(${maxDepth})，停止递归`, 'warning', this.taskId);
      return userIds;
    }

    // 检查连续错误数限制
    if (errorCount >= maxErrors) {
      this.logManager.addLog(`连续错误数达到限制(${maxErrors})，停止递归`, 'warning', this.taskId);
      return userIds;
    }

    let currentErrorCount = errorCount;
    let hasNewData = false;
    const originalLength = userIds.length;
    const processedUsers = userIds.slice(); // 使用副本避免在迭代中修改数组

    for (const user of processedUsers) {
      try {
        const resJson = await this.getAuthorRecommend(user);
        if (resJson) {
          const addUserIds = getAuthorRecommendPids(resJson as any);
          if (addUserIds && addUserIds.length > 0) {
            // 去重处理
            const uniqueUserIds = addUserIds.filter(id => !userIds.includes(id));
            if (uniqueUserIds.length > 0) {
              userIds.push(...uniqueUserIds);
              hasNewData = true;
              currentErrorCount = 0; // 重置错误计数

              if (userIds.length >= targetNum) {
                return userIds;
              }
            }
          }
        } else {
          currentErrorCount++;
        }
      } catch (error) {
        currentErrorCount++;
        this.logManager.addLog(`获取用户${user}推荐时出错: ${error instanceof Error ? error.message : String(error)}`, 'warning', this.taskId);
      }
    }

    // 如果没有新数据且已经尝试了所有用户，停止递归
    if (!hasNewData || userIds.length === originalLength) {
      this.logManager.addLog(`没有获取到新的用户推荐数据，停止递归`, 'info', this.taskId);
      return userIds;
    }

    // 递归调用，增加深度
    return this.reGetAuthor(userIds, targetNum, depth + 1, maxDepth, currentErrorCount, maxErrors);
  }

  /**
   * 递归获取插画推荐，带有深度限制和错误处理
   * @param pids 插画ID列表
   * @param targetNum 目标数量
   * @param depth 当前递归深度
   * @param maxDepth 最大递归深度
   * @param errorCount 连续错误计数
   * @param maxErrors 最大连续错误数
   */
  private async reGetIllust(
    pids: string[],
    targetNum: number,
    depth: number = 0,
    maxDepth: number = 5,
    errorCount: number = 0,
    maxErrors: number = 10
  ): Promise<string[]> {
    // 检查是否达到目标数量
    if (pids.length >= targetNum) {
      return pids;
    }

    // 检查递归深度限制
    if (depth >= maxDepth) {
      this.logManager.addLog(`递归获取插画推荐达到最大深度限制(${maxDepth})，停止递归`, 'warning', this.taskId);
      return pids;
    }

    // 检查连续错误数限制
    if (errorCount >= maxErrors) {
      this.logManager.addLog(`连续错误数达到限制(${maxErrors})，停止递归`, 'warning', this.taskId);
      return pids;
    }

    const seenPids = new Set(pids); // 使用集合避免重复
    let currentErrorCount = errorCount;
    let hasNewData = false;
    const originalLength = pids.length;
    const processedPids = pids.slice(); // 使用副本避免在迭代中修改数组

    for (const pid of processedPids) {
      try {
        let pidHasNewData = false;
        let pidErrorCount = 0;

        // 1. 处理插画推荐
        const illustRecommendJson = await this.getIllustRecommend(pid);
        if (illustRecommendJson) {
          const illustRecommendPids = getIllustRecommendPids(illustRecommendJson as any);
          if (illustRecommendPids && illustRecommendPids.length > 0) {
            for (const newPid of illustRecommendPids) {
              if (!seenPids.has(newPid)) {
                pids.push(newPid);
                seenPids.add(newPid);
                pidHasNewData = true;
              }
            }
          }
        } else {
          pidErrorCount++;
        }

        // 2. 处理用户推荐（独立于插画推荐）
        const illustInfo = await this.getIllustInfo(pid);
        if (illustInfo && typeof illustInfo === 'object' && 'body' in illustInfo) {
          const userId = getIllustUser(illustInfo as PixivIllustInfo);
          if (userId) {
            const userRecommendJson = await this.getAuthorRecommend(userId);
            if (userRecommendJson) {
              const userRecommendPids = getAuthorRecommendPids(userRecommendJson as any);
              if (userRecommendPids && userRecommendPids.length > 0) {
                for (const newPid of userRecommendPids) {
                  if (!seenPids.has(newPid)) {
                    pids.push(newPid);
                    seenPids.add(newPid);
                    pidHasNewData = true;
                  }
                }
              }
            } else {
              pidErrorCount++;
              this.logManager.addLog(`获取用户${userId}推荐异常: Request failed with status code 400`, 'warning', this.taskId);
            }
          }
        }

        // 只有当插画推荐和用户推荐都失败时才增加错误计数
        if (pidHasNewData) {
          hasNewData = true;
          currentErrorCount = 0; // 重置错误计数
        } else if (pidErrorCount >= 2) {
          // 两个推荐都失败才算错误
          currentErrorCount++;
        }

        if (pids.length >= targetNum) {
          return pids;
        }
      } catch (error) {
        currentErrorCount++;
        this.logManager.addLog(`递归获取插画pid：${pid}出现异常：${error}，自动跳过`, 'warning', this.taskId);
        continue;
      }
    }

    // 如果没有新数据且已经尝试了所有pid，停止递归
    if (!hasNewData || pids.length === originalLength) {
      this.logManager.addLog(`没有获取到新的插画推荐数据，停止递归`, 'info', this.taskId);
      return pids;
    }

    // 递归调用，增加深度
    return this.reGetIllust(pids, targetNum, depth + 1, maxDepth, currentErrorCount, maxErrors);
  }

  async getPidsFilterByTags(tags: string[], pids: string[]): Promise<string[]> {
    const resPids: string[] = [];
    
    for (const pid of pids) {
      const info = await this.getIllustInfo(pid);
      if (info && typeof info === 'object' && 'body' in info) {
        const pidTags = getIllustTags(info as PixivIllustInfo);
        if (tags.every(tag => pidTags.includes(tag))) {
          resPids.push(pid);
        }
      }
    }
    
    return resPids;
  }

  /**
   * 仅获取插画推荐的PID列表（不获取详细信息）
   * @param pid 起始插画ID
   * @param targetNum 目标获取数量
   * @returns 推荐的PID列表
   */
  async getIllustRecommendPids(pid: string, targetNum: number = CRAWLER_CONFIG.MAX_ILLUSTRATIONS): Promise<string[]> {
    const startTime = Date.now();
    this.logManager.addLog(`开始获取插画${pid}的推荐PID列表，目标数量：${targetNum}`, 'info', this.taskId);

    try {
      // 创建或更新pic_task记录
      await this.supabase.createOrUpdatePicTask(pid);

      // 获取插画推荐
      const recommendJson = await this.getIllustRecommend(pid);
      if (!recommendJson) {
        this.logManager.addLog(`获取插画${pid}推荐失败`, 'warning', this.taskId);
        return [];
      }

      const illustRecommendPids = getRecommendPidsFromResponse(recommendJson);
      if (!illustRecommendPids || illustRecommendPids.length === 0) {
        this.logManager.addLog(`插画${pid}没有推荐内容`, 'info', this.taskId);
        return [];
      }

      // 限制返回数量
      const resultPids = illustRecommendPids.slice(0, targetNum);

      // 批量创建pic_task记录
      if (resultPids.length > 0) {
        await this.supabase.batchCreatePicTasks(resultPids);
      }

      // 更新插画推荐状态
      await this.supabase.updateIllustRecommendStatus(pid, resultPids.length);

      const endTime = Date.now();
      const elapsedTime = (endTime - startTime) / 1000;

      this.logManager.addLog(`插画${pid}推荐PID获取完成，获取到${resultPids.length}个PID，耗时：${elapsedTime.toFixed(2)}秒`, 'success', this.taskId);

      return resultPids;
    } catch (error) {
      this.logManager.addLog(`获取插画${pid}推荐PID异常: ${error instanceof Error ? error.message : String(error)}`, 'error', this.taskId);
      return [];
    }
  }

  /**
   * 仅获取作者推荐的PID列表（不获取详细信息）
   * @param pid 起始插画ID（用于获取作者信息）
   * @param targetNum 目标获取数量
   * @returns 作者推荐的PID列表
   */
  async getAuthorRecommendPids(pid: string, targetNum: number = CRAWLER_CONFIG.MAX_ILLUSTRATIONS): Promise<string[]> {
    const startTime = Date.now();
    this.logManager.addLog(`开始获取插画${pid}作者的推荐PID列表，目标数量：${targetNum}`, 'info', this.taskId);

    try {
      // 创建或更新pic_task记录
      await this.supabase.createOrUpdatePicTask(pid);

      // 先获取插画信息以获得作者ID
      const illustInfo = await this.getIllustInfo(pid);
      if (!illustInfo || typeof illustInfo !== 'object' || !('body' in illustInfo)) {
        this.logManager.addLog(`获取插画${pid}信息失败，无法获取作者推荐`, 'warning', this.taskId);
        return [];
      }

      const userId = getIllustUser(illustInfo as PixivIllustInfo);
      if (!userId) {
        this.logManager.addLog(`插画${pid}没有作者信息`, 'warning', this.taskId);
        return [];
      }

      // 获取作者推荐
      const userRecommendJson = await this.getAuthorRecommend(userId);
      if (!userRecommendJson) {
        this.logManager.addLog(`获取作者${userId}推荐失败`, 'warning', this.taskId);
        return [];
      }

      const authorRecommendPids = getAuthorRecommendPids(userRecommendJson as any);
      if (!authorRecommendPids || authorRecommendPids.length === 0) {
        this.logManager.addLog(`作者${userId}没有推荐内容`, 'info', this.taskId);
        return [];
      }

      // 限制返回数量
      const resultPids = authorRecommendPids.slice(0, targetNum);

      // 批量创建pic_task记录
      if (resultPids.length > 0) {
        await this.supabase.batchCreatePicTasks(resultPids);
      }

      // 更新作者推荐状态
      await this.supabase.updateAuthorRecommendStatus(pid, resultPids.length);

      const endTime = Date.now();
      const elapsedTime = (endTime - startTime) / 1000;

      this.logManager.addLog(`作者${userId}推荐PID获取完成，获取到${resultPids.length}个PID，耗时：${elapsedTime.toFixed(2)}秒`, 'success', this.taskId);

      return resultPids;
    } catch (error) {
      this.logManager.addLog(`获取插画${pid}作者推荐PID异常: ${error instanceof Error ? error.message : String(error)}`, 'error', this.taskId);
      return [];
    }
  }

  /**
   * 获取指定PID的详细信息并入库pic表
   * @param pid 插画ID
   * @returns 是否成功获取并保存详细信息
   */
  async getPidDetailInfo(pid: string): Promise<boolean> {
    const startTime = Date.now();
    this.logManager.addLog(`开始获取插画${pid}的详细信息并入库`, 'info', this.taskId);

    try {
      // 创建或更新pic_task记录
      await this.supabase.createOrUpdatePicTask(pid);

      // 获取插画详细信息
      const info = await this.getIllustInfo(pid);
      if (!info) {
        this.logManager.addLog(`获取插画${pid}详细信息失败`, 'warning', this.taskId);
        return false;
      }

      // 检查是否是 404 错误（图片不存在）
      if (info && typeof info === 'object' && 'error' in info && info.error === true && 'status' in info && info.status === 404) {
        this.logManager.addLog(`插画${pid}不存在（404错误），删除pic_task记录并跳过处理`, 'warning', this.taskId);
        try {
          await this.supabase.deletePicTask(pid);
          this.logManager.addLog(`已删除插画${pid}的pic_task记录`, 'info', this.taskId);
        } catch (deleteError) {
          this.logManager.addLog(`删除插画${pid}的pic_task记录失败: ${deleteError instanceof Error ? deleteError.message : String(deleteError)}`, 'error', this.taskId);
        }
        return false;
      }

      // 确保 info 是有效的 PixivIllustInfo 类型
      if (!info || typeof info !== 'object' || !('body' in info)) {
        this.logManager.addLog(`插画${pid}信息格式无效`, 'warning', this.taskId);
        return false;
      }

      // 检查热度阈值
      const popularity = getIllustPopularity(info as PixivIllustInfo);
      const roundedPopularity = Math.round(popularity * 100) / 100;

      if (roundedPopularity < this.popularityThreshold) {
        this.logManager.addLog(`插画${pid}热度${roundedPopularity}低于阈值${this.popularityThreshold}，跳过入库`, 'info', this.taskId);
        // 更新详细信息状态（即使跳过也标记为已处理）
        await this.supabase.updateDetailInfoStatus(pid);
        return false;
      }

      // 提取插画数据
      const viewJson = getIllustData(info as PixivIllustInfo);
      if (!viewJson) {
        this.logManager.addLog(`插画${pid}数据解析失败`, 'warning', this.taskId);
        return false;
      }

      const illustTags = getIllustTags(info as PixivIllustInfo);
      const title = getIllustTitle(info as PixivIllustInfo);
      const authorId = getIllustAuthorId(info as PixivIllustInfo);
      const authorName = getIllustAuthorName(info as PixivIllustInfo);
      const tagsString = illustTags.join(', ');

      // 构建数据库记录
      const picData: DatabasePic = {
        pid: pid,
        title: title || undefined,
        author_id: authorId || undefined,
        author_name: authorName || undefined,
        tag: tagsString,
        good: viewJson.like,
        star: viewJson.bookmark,
        view: viewJson.view,
        image_path: '',
        image_url: '',
        popularity: roundedPopularity
      };

      // 保存到数据库
      await this.supabase.createPic(picData);

      // 更新详细信息状态
      await this.supabase.updateDetailInfoStatus(pid);

      const endTime = Date.now();
      const elapsedTime = (endTime - startTime) / 1000;

      this.logManager.addLog(`插画${pid}详细信息获取并入库完成，热度：${roundedPopularity}，耗时：${elapsedTime.toFixed(2)}秒`, 'success', this.taskId);

      return true;
    } catch (error) {
      // 解析错误信息，提供更友好的提示
      let errorMessage = '';
      let isDuplicate = false;

      if (error && typeof error === 'object') {
        // 检查是否是Supabase错误
        if ('code' in error && 'message' in error) {
          const supabaseError = error as any;
          if (supabaseError.code === '23505' || supabaseError.message?.includes('duplicate key')) {
            errorMessage = `PID:${pid} 已存在于数据库中，跳过重复插入`;
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
        // 即使重复也更新状态为已处理
        await this.supabase.updateDetailInfoStatus(pid);
        return true;
      } else {
        this.logManager.addLog(`获取插画${pid}详细信息异常: ${errorMessage}`, 'error', this.taskId);
        return false;
      }
    }
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

        if (info && typeof info === 'object' && 'body' in info) {
          const popularity = getIllustPopularity(info as PixivIllustInfo);
          const roundedPopularity = Math.round(popularity * 100) / 100;

          const viewJson = getIllustData(info as PixivIllustInfo);
          if (viewJson) {
            const illustTags = getIllustTags(info as PixivIllustInfo);
            const title = getIllustTitle(info as PixivIllustInfo);
            const authorId = getIllustAuthorId(info as PixivIllustInfo);
            const authorName = getIllustAuthorName(info as PixivIllustInfo);

            this.logManager.addLog(`view_json:${JSON.stringify(viewJson)}`, 'info', this.taskId);
            this.logManager.addLog(`tag:${JSON.stringify(illustTags)}`, 'info', this.taskId);
            this.logManager.addLog(`title:${title}`, 'info', this.taskId);
            this.logManager.addLog(`author_id:${authorId}, author_name:${authorName}`, 'info', this.taskId);

            const tagsString = illustTags.join(', ');

            const picData: DatabasePic = {
              pid: firstPid,
              title: title || undefined,
              author_id: authorId || undefined,
              author_name: authorName || undefined,
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