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
import { TursoService } from '../db/turso';
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

// ========================================
// 日志管理器接口
// ========================================

export interface ILogManager {
  addLog(message: string, type: 'info' | 'error' | 'warning' | 'success', taskId?: string): void;
}

// 简单的控制台日志管理器
export class ConsoleLogManager implements ILogManager {
  addLog(message: string, type: 'info' | 'error' | 'warning' | 'success', taskId?: string): void {
    const timestamp = new Date().toISOString();
    const prefix = taskId ? `[${taskId}]` : '';
    console.log(`[${timestamp}] [${type.toUpperCase()}] ${prefix} ${message}`);
  }
}

// ========================================
// Pixiv 爬虫服务类 (Turso 版本)
// ========================================

export class PixivCrawler {
  private initPid: string;
  private headers: PixivHeaders;
  private headersList: PixivHeaders[];
  private headerIndex: number;
  private turso: TursoService;  // 使用 Turso 替代 Supabase
  private httpClient: AxiosInstance;
  private logManager: ILogManager;
  private taskId: string;
  private popularityThreshold: number;

  /**
   * PixivCrawler 构造函数
   * @param pid 起始插画ID
   * @param headersList Pixiv请求头列表
   * @param logManager 日志管理器
   * @param taskId 任务ID
   * @param popularityThreshold 热度阈值，默认为0
   * @param tursoService 可选的 TursoService 实例（用于复用连接）
   */
  constructor(
    pid: string,
    headersList: PixivHeaders[],
    logManager: ILogManager,
    taskId: string,
    popularityThreshold: number = 0,
    tursoService?: TursoService
  ) {
    this.initPid = pid;
    this.headers = headersList[0];
    this.headersList = headersList;
    this.headerIndex = 0;
    this.turso = tursoService || new TursoService();
    this.logManager = logManager;
    this.taskId = taskId;
    this.popularityThreshold = popularityThreshold;

    this.httpClient = axios.create({
      timeout: CRAWLER_CONFIG.HTTP_TIMEOUT,
      headers: this.headers as any
    });
  }

  /**
   * 切换到下一个请求头
   */
  private setNextHeader(): void {
    const lenHeadersList = this.headersList.length;
    this.headerIndex = (this.headerIndex + 1) % lenHeadersList;
    this.headers = this.headersList[this.headerIndex];
    this.httpClient.defaults.headers = this.headers as any;
    this.logManager.addLog(`切换到p站headers第${this.headerIndex + 1}个`, 'info', this.taskId);
  }

  /**
   * 获取插画详细信息
   * @param pid 插画ID
   * @returns 插画信息或null
   */
  async getIllustInfo(pid: string): Promise<PixivIllustResult | null> {
    let retries = 0;
    const maxRetries = CRAWLER_CONFIG.MAX_RETRIES;

    while (retries <= maxRetries) {
      try {
        // 添加延迟
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

        // 检查是否是 404 错误
        if (error && typeof error === 'object' && 'response' in error) {
          const axiosError = error as any;
          if (axiosError.response && axiosError.response.status === 404) {
            this.logManager.addLog(`插画${pid}不存在（404错误），图片可能已被删除`, 'warning', this.taskId);
            return { error: true, status: 404, message: 'Image not found' };
          }
        }

        if (retries > maxRetries) {
          this.logManager.addLog(`获取插画${pid}信息异常(重试${maxRetries}次后失败): ${error instanceof Error ? error.message : String(error)}`, 'error', this.taskId);
          return null;
        }
        this.logManager.addLog(`获取插画${pid}信息异常，第${retries}次重试: ${error instanceof Error ? error.message : String(error)}`, 'warning', this.taskId);
      }
    }

    return null;
  }

  /**
   * 获取插画推荐列表
   * @param pid 插画ID
   * @returns 推荐响应或null
   */
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
        this.logManager.addLog(`获取插画推荐失败，错误json为${JSON.stringify(resJson)}`, 'warning', this.taskId);
        return null;
      }
    } catch (error) {
      this.logManager.addLog(`获取插画${pid}推荐异常: ${error instanceof Error ? error.message : String(error)}`, 'error', this.taskId);
      return null;
    }
  }

  /**
   * 获取作者推荐
   * @param authorId 作者ID
   * @returns 推荐响应或null
   */
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

  /**
   * 获取首页推荐 PID 列表
   * @returns PID数组或null
   */
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

      const htmlAfterRecommend = html.substring(recommendIndex);

      // 提取 data-gtm-work-id
      const pidRegex = /data-gtm-work-id=["'](\d+)["']/gi;
      const pids: string[] = [];
      const seen = new Set<string>();
      let match: RegExpExecArray | null;

      while ((match = pidRegex.exec(htmlAfterRecommend)) !== null) {
        const pid = match[1];
        if (!seen.has(pid)) {
          seen.add(pid);
          pids.push(pid);
          if (pids.length >= 500) break;
        }
      }

      this.logManager.addLog(`首页推荐提取到 ${pids.length} 个唯一PID`, 'info', this.taskId);
      return pids;
    } catch (error) {
      this.logManager.addLog(`获取首页推荐异常: ${error instanceof Error ? error.message : String(error)}`, 'error', this.taskId);
      return null;
    }
  }

  /**
   * 获取排行榜数据 (使用 JSON API)
   * @param mode 排行类型
   * @returns 排行榜响应或null
   */
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
      console.log('rankings:', rankings);
      this.logManager.addLog(`获取${mode}榜单成功，共 ${rankings.length} 个PID`, 'info', this.taskId);
      return { body: { rankings }, error: false };
    } catch (error) {
      this.logManager.addLog(`获取${mode}榜单异常: ${error instanceof Error ? error.message : String(error)}`, 'error', this.taskId);
      return null;
    }
  }

  async getDailyRank(): Promise<PixivDailyRankResponse | null> {
    return this.getRankByMode('daily');
  }

  async getWeeklyRank(): Promise<PixivDailyRankResponse | null> {
    return this.getRankByMode('weekly');
  }

  async getMonthlyRank(): Promise<PixivDailyRankResponse | null> {
    return this.getRankByMode('monthly');
  }

  // ========================================
  // 推荐 PID 获取方法
  // ========================================

  /**
   * 仅获取插画推荐的PID列表（不获取详细信息）
   * 利用 Turso 本地副本进行高速去重检查
   * @param pid 起始插画ID
   * @param targetNum 目标获取数量
   * @returns 推荐的PID列表
   */
  async getIllustRecommendPids(pid: string, targetNum: number = CRAWLER_CONFIG.MAX_ILLUSTRATIONS): Promise<string[]> {
    const startTime = Date.now();
    this.logManager.addLog(`开始获取插画${pid}的推荐PID列表，目标数量：${targetNum}`, 'info', this.taskId);

    try {
      // 创建或更新 pic_task 记录
      await this.turso.createOrUpdatePicTask(pid);

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

      // 利用 Turso 本地副本进行高速去重检查
      const existingPids = await this.turso.getExistingPids(illustRecommendPids);
      const newPids = illustRecommendPids.filter(p => !existingPids.has(p));

      this.logManager.addLog(`去重检查: ${illustRecommendPids.length} 个PID中有 ${newPids.length} 个是新的`, 'info', this.taskId);

      // 限制返回数量
      const resultPids = newPids.slice(0, targetNum);

      // 批量创建 pic_task 记录
      if (resultPids.length > 0) {
        await this.turso.batchCreatePicTasks(resultPids);
      }

      // 更新插画推荐状态
      await this.turso.updateIllustRecommendStatus(pid, resultPids.length);

      const endTime = Date.now();
      const elapsedTime = (endTime - startTime) / 1000;

      this.logManager.addLog(`插画${pid}推荐PID获取完成，获取到${resultPids.length}个新PID，耗时：${elapsedTime.toFixed(2)}秒`, 'success', this.taskId);

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
      await this.turso.createOrUpdatePicTask(pid);

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

      // 高速去重检查
      const existingPids = await this.turso.getExistingPids(authorRecommendPids);
      const newPids = authorRecommendPids.filter(p => !existingPids.has(p));

      const resultPids = newPids.slice(0, targetNum);

      if (resultPids.length > 0) {
        await this.turso.batchCreatePicTasks(resultPids);
      }

      await this.turso.updateAuthorRecommendStatus(pid, resultPids.length);

      const endTime = Date.now();
      const elapsedTime = (endTime - startTime) / 1000;

      this.logManager.addLog(`作者${userId}推荐PID获取完成，获取到${resultPids.length}个新PID，耗时：${elapsedTime.toFixed(2)}秒`, 'success', this.taskId);

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
      await this.turso.createOrUpdatePicTask(pid);

      const info = await this.getIllustInfo(pid);
      if (!info) {
        this.logManager.addLog(`获取插画${pid}详细信息失败`, 'warning', this.taskId);
        return false;
      }

      // 检查 404 错误
      if (info && typeof info === 'object' && 'error' in info && info.error === true && 'status' in info && info.status === 404) {
        this.logManager.addLog(`插画${pid}不存在（404错误），删除pic_task记录并跳过处理`, 'warning', this.taskId);
        try {
          await this.turso.deletePicTask(pid);
        } catch (deleteError) {
          this.logManager.addLog(`删除pic_task记录失败: ${deleteError instanceof Error ? deleteError.message : String(deleteError)}`, 'error', this.taskId);
        }
        return false;
      }

      if (!info || typeof info !== 'object' || !('body' in info)) {
        this.logManager.addLog(`插画${pid}信息格式无效`, 'warning', this.taskId);
        return false;
      }

      // 检查热度阈值
      const popularity = getIllustPopularity(info as PixivIllustInfo);
      const roundedPopularity = Math.round(popularity * 100) / 100;

      if (roundedPopularity < this.popularityThreshold) {
        this.logManager.addLog(`插画${pid}热度${roundedPopularity}低于阈值${this.popularityThreshold}，跳过入库`, 'info', this.taskId);
        await this.turso.updateDetailInfoStatus(pid);
        return false;
      }

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

      // 使用 upsert 避免重复插入错误
      await this.turso.upsertPic(picData);
      await this.turso.updateDetailInfoStatus(pid);

      const endTime = Date.now();
      const elapsedTime = (endTime - startTime) / 1000;

      this.logManager.addLog(`插画${pid}详细信息获取并入库完成，热度：${roundedPopularity}，耗时：${elapsedTime.toFixed(2)}秒`, 'success', this.taskId);

      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logManager.addLog(`获取插画${pid}详细信息异常: ${errorMessage}`, 'error', this.taskId);
      return false;
    }
  }

  /**
   * 批量获取PID详细信息并入库
   * 利用 Turso 批量操作优化性能
   * @param pids PID数组
   * @returns 成功数量
   */
  async batchGetPidDetailInfo(pids: string[]): Promise<number> {
    const startTime = Date.now();
    let successCount = 0;
    let failCount = 0;
    let requestCount = 0;

    this.logManager.addLog(`开始批量获取 ${pids.length} 个PID的详细信息`, 'info', this.taskId);

    for (const pid of pids) {
      // 每300次请求换一个cookie
      if ((requestCount % CRAWLER_CONFIG.MAX_REQUESTS_PER_HEADER) === CRAWLER_CONFIG.MAX_REQUESTS_PER_HEADER - 1) {
        this.setNextHeader();
      }

      try {
        const success = await this.getPidDetailInfo(pid);
        if (success) {
          successCount++;
        }
        requestCount++;
      } catch (error) {
        failCount++;
        this.logManager.addLog(`处理PID:${pid}异常: ${error instanceof Error ? error.message : String(error)}`, 'warning', this.taskId);
      }
    }

    const endTime = Date.now();
    const elapsedTime = (endTime - startTime) / 1000;

    this.logManager.addLog(`批量处理完成，成功: ${successCount}，失败: ${failCount}，耗时: ${elapsedTime.toFixed(2)}秒`, 'success', this.taskId);

    return successCount;
  }
}
