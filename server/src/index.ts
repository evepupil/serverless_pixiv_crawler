import http from 'http';
import path from 'path';
import dotenv from 'dotenv';

import { TursoService } from './db/turso';
import { PixivCrawler, ConsoleLogManager } from './crawler';
import { PixivProxy, PixivDownloader } from './proxy';
import { parseSizeList } from './proxy/storage-path';
import { TaskScheduler } from './scheduler';
import { checkEnvironmentVariables, checkB2Config, getPixivHeaders } from './config';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

type TaskType = 'illust_recommend' | 'author_recommend' | 'detail_info';
type RankType = 'daily' | 'weekly' | 'monthly';

let dbService: TursoService | null = null;
let scheduler: TaskScheduler | null = null;
const logManager = new ConsoleLogManager();

function getDbService(): TursoService {
  if (!dbService) {
    dbService = new TursoService();
  }
  return dbService;
}

function parseQueryParams(url: string): Record<string, string> {
  const params: Record<string, string> = {};
  const queryStart = url.indexOf('?');
  if (queryStart === -1) return params;

  const queryString = url.substring(queryStart + 1);
  for (const pair of queryString.split('&')) {
    const [key, value] = pair.split('=');
    if (key) {
      params[decodeURIComponent(key)] = decodeURIComponent(value || '');
    }
  }
  return params;
}

async function parseBody(req: http.IncomingMessage): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, statusCode: number, data: unknown) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

function parseBooleanLike(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  }
  return false;
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw === undefined ? NaN : parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseFloatEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw === undefined ? NaN : parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getAutoPreviewWindowConfig(body: Record<string, any>) {
  return {
    rankingDailyDays: Math.max(1, parseInt(String(body.rankingDailyDays ?? parseIntEnv('AUTO_PREVIEW_RANKING_DAILY_DAYS', 3)), 10) || 3),
    rankingWeeklyDays: Math.max(1, parseInt(String(body.rankingWeeklyDays ?? parseIntEnv('AUTO_PREVIEW_RANKING_WEEKLY_DAYS', 7)), 10) || 7),
    rankingMonthlyDays: Math.max(1, parseInt(String(body.rankingMonthlyDays ?? parseIntEnv('AUTO_PREVIEW_RANKING_MONTHLY_DAYS', 14)), 10) || 14),
    homeDays: Math.max(1, parseInt(String(body.homeDays ?? parseIntEnv('AUTO_PREVIEW_HOME_DAYS', 7)), 10) || 7),
    illustRecommendDays: Math.max(1, parseInt(String(body.illustRecommendDays ?? parseIntEnv('AUTO_PREVIEW_ILLUST_RECOMMEND_DAYS', 7)), 10) || 7),
    authorRecommendDays: Math.max(1, parseInt(String(body.authorRecommendDays ?? parseIntEnv('AUTO_PREVIEW_AUTHOR_RECOMMEND_DAYS', 14)), 10) || 14),
    manualDays: Math.max(1, parseInt(String(body.manualDays ?? parseIntEnv('AUTO_PREVIEW_MANUAL_DAYS', 30)), 10) || 30)
  };
}

function getAutoPreviewQuotaConfig(body: Record<string, any>) {
  return {
    rankingDailyRatio: Math.max(0, parseFloat(String(body.rankingDailyRatio ?? parseFloatEnv('AUTO_PREVIEW_QUOTA_RANKING_DAILY', 0.4))) || 0.4),
    rankingWeeklyRatio: Math.max(0, parseFloat(String(body.rankingWeeklyRatio ?? parseFloatEnv('AUTO_PREVIEW_QUOTA_RANKING_WEEKLY', 0.2))) || 0.2),
    homeRatio: Math.max(0, parseFloat(String(body.homeRatio ?? parseFloatEnv('AUTO_PREVIEW_QUOTA_HOME', 0.2))) || 0.2),
    relatedRatio: Math.max(0, parseFloat(String(body.relatedRatio ?? parseFloatEnv('AUTO_PREVIEW_QUOTA_RELATED', 0.2))) || 0.2),
    manualRatio: Math.max(0, parseFloat(String(body.manualRatio ?? parseFloatEnv('AUTO_PREVIEW_QUOTA_MANUAL', 0))) || 0)
  };
}

function isTaskType(value: string | undefined): value is TaskType {
  return value === 'illust_recommend' || value === 'author_recommend' || value === 'detail_info';
}

function isRankType(value: string | undefined): value is RankType {
  return value === 'daily' || value === 'weekly' || value === 'monthly';
}

async function handleGetAction(
  action: string | undefined,
  query: Record<string, string>,
  res: http.ServerResponse,
  db: TursoService
) {
  switch (action) {
    case 'status': {
      sendJson(res, 200, {
        status: 'running',
        timestamp: new Date().toISOString(),
        environment: 'tokyo-server',
        nodeVersion: process.version,
        platform: process.platform,
        database: 'turso'
      });
      return;
    }

    case 'stats': {
      const stats = await db.getStatsFromView();
      sendJson(res, 200, stats);
      return;
    }

    case 'env-check': {
      const envCheck = checkEnvironmentVariables();
      const b2Check = checkB2Config();
      sendJson(res, 200, {
        valid: envCheck.valid,
        missing: envCheck.missing,
        b2Valid: b2Check.valid,
        b2Missing: b2Check.missing,
        timestamp: new Date().toISOString()
      });
      return;
    }

    case 'get-pic': {
      const pid = query.pid;
      if (!pid) {
        sendJson(res, 400, { error: 'Missing pid' });
        return;
      }

      const pic = await db.getPicByPid(pid);
      if (!pic) {
        sendJson(res, 404, { success: false, error: 'PID not found' });
        return;
      }

      sendJson(res, 200, { success: true, data: pic });
      return;
    }

    case 'random-pids': {
      const count = parseInt(query.count || '10', 10);
      if (!Number.isFinite(count) || count < 1 || count > 100) {
        sendJson(res, 400, { error: 'count must be between 1 and 100' });
        return;
      }

      const pids = await db.getRandomPids(count);
      sendJson(res, 200, {
        success: true,
        pids,
        count: pids.length,
        timestamp: new Date().toISOString()
      });
      return;
    }

    case 'uncompleted-tasks': {
      const taskType = query.type;
      const limit = parseInt(query.limit || '100', 10);
      if (!isTaskType(taskType)) {
        sendJson(res, 400, { error: 'Invalid task type' });
        return;
      }

      const tasks = await db.getUncompletedTasks(taskType, limit);
      sendJson(res, 200, {
        success: true,
        taskType,
        pids: tasks,
        count: tasks.length,
        timestamp: new Date().toISOString()
      });
      return;
    }

    case 'exists': {
      const pid = query.pid;
      if (!pid) {
        sendJson(res, 400, { error: 'Missing pid' });
        return;
      }

      const exists = await db.existsPid(pid);
      sendJson(res, 200, { pid, exists });
      return;
    }

    case 'scheduler-status': {
      sendJson(res, 200, {
        success: !!scheduler,
        ...(scheduler ? scheduler.getStatus() : { isRunning: false, tasks: [] }),
        timestamp: new Date().toISOString()
      });
      return;
    }

    case 'scheduler-start': {
      if (!scheduler) {
        sendJson(res, 500, { error: 'Scheduler not initialized' });
        return;
      }
      scheduler.start();
      sendJson(res, 200, { success: true, message: 'Scheduler started', timestamp: new Date().toISOString() });
      return;
    }

    case 'scheduler-stop': {
      if (!scheduler) {
        sendJson(res, 500, { error: 'Scheduler not initialized' });
        return;
      }
      scheduler.stop();
      sendJson(res, 200, { success: true, message: 'Scheduler stopped', timestamp: new Date().toISOString() });
      return;
    }

    case 'scheduler-trigger': {
      const task = query.task;
      if (!task) {
        sendJson(res, 400, { error: 'Missing task' });
        return;
      }
      if (!scheduler) {
        sendJson(res, 500, { error: 'Scheduler not initialized' });
        return;
      }
      await scheduler.triggerTask(task);
      sendJson(res, 200, { success: true, message: `Triggered task: ${task}`, timestamp: new Date().toISOString() });
      return;
    }

    case 'illust-recommend-pids': {
      const pid = query.pid;
      const targetNum = parseInt(query.targetNum || '30', 10);
      if (!pid) {
        sendJson(res, 400, { error: 'Missing pid' });
        return;
      }

      try {
        const taskId = `illust_recommend_${pid}_${Date.now()}`;
        const headersList = getPixivHeaders();
        const crawler = new PixivCrawler(pid, headersList, logManager, taskId, 0, db);
        const pids = await crawler.getIllustRecommendPids(pid, targetNum);
        sendJson(res, 200, { success: true, pid, targetNum, pids, count: pids.length, taskId, timestamp: new Date().toISOString() });
      } catch (error) {
        sendJson(res, 500, { error: 'Failed to get illust recommend pids', message: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    case 'author-recommend-pids': {
      const pid = query.pid;
      const targetNum = parseInt(query.targetNum || '30', 10);
      if (!pid) {
        sendJson(res, 400, { error: 'Missing pid' });
        return;
      }

      try {
        const taskId = `author_recommend_${pid}_${Date.now()}`;
        const headersList = getPixivHeaders();
        const crawler = new PixivCrawler(pid, headersList, logManager, taskId, 0, db);
        const pids = await crawler.getAuthorRecommendPids(pid, targetNum);
        sendJson(res, 200, { success: true, pid, targetNum, pids, count: pids.length, taskId, timestamp: new Date().toISOString() });
      } catch (error) {
        sendJson(res, 500, { error: 'Failed to get author recommend pids', message: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    case 'pid-detail-info': {
      const pid = query.pid;
      if (!pid) {
        sendJson(res, 400, { error: 'Missing pid' });
        return;
      }

      try {
        const taskId = `detail_info_${pid}_${Date.now()}`;
        const threshold = parseFloat(query.threshold || '0');
        const headersList = getPixivHeaders();
        const crawler = new PixivCrawler(pid, headersList, logManager, taskId, threshold, db);
        const success = await crawler.getPidDetailInfo(pid);
        sendJson(res, 200, { success, pid, taskId, timestamp: new Date().toISOString() });
      } catch (error) {
        sendJson(res, 500, { error: 'Failed to get pid detail info', message: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    case 'home': {
      try {
        const taskId = `home_${Date.now()}`;
        const headersList = getPixivHeaders();
        const crawler = new PixivCrawler('0', headersList, logManager, taskId, 0, db);
        const pids = (await crawler.getHomeRecommendedPids()) || [];
        if (pids.length > 0) {
          await db.batchCreatePicTasks(pids, {
            priority: 720,
            sourceType: 'home',
            sourceKey: `home:${new Date().toISOString().slice(0, 10)}`,
            sourceRecentAt: new Date().toISOString().slice(0, 19).replace('T', ' ')
          });
        }

        sendJson(res, 200, {
          success: pids.length > 0,
          message: pids.length > 0 ? 'Home recommended pids stored into pic_task' : 'No home recommended pids found',
          count: pids.length,
          pids: pids.slice(0, 20),
          taskId,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        sendJson(res, 500, { error: 'Failed to get home recommended pids', message: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    case 'daily':
    case 'weekly':
    case 'monthly': {
      const rankType = action;
      if (!isRankType(rankType)) {
        sendJson(res, 400, { error: 'Invalid rank type' });
        return;
      }

      try {
        const taskId = `${rankType}_${Date.now()}`;
        const headersList = getPixivHeaders();
        const crawler = new PixivCrawler('0', headersList, logManager, taskId, 0, db);
        const rankMethod = rankType === 'daily'
          ? crawler.getDailyRank
          : rankType === 'weekly'
            ? crawler.getWeeklyRank
            : crawler.getMonthlyRank;
        const result = await rankMethod.call(crawler);

        if (!result || result.error !== false) {
          sendJson(res, 200, { success: false, type: rankType, message: 'Rank crawl returned empty result', taskId, timestamp: new Date().toISOString() });
          return;
        }

        const rankDate = new Date().toISOString().slice(0, 10);
        await db.upsertRankings(result.body.rankings, rankDate, rankType);
        await db.enqueueRankingTasks(result.body.rankings, rankDate, rankType);

        sendJson(res, 200, {
          success: true,
          type: rankType,
          count: result.body.rankings.length,
          rankDate,
          taskId,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        sendJson(res, 500, { error: `Failed to crawl ${rankType} rank`, message: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    case 'proxy': {
      const pid = query.pid;
      const targetSize = query.size || 'original';
      if (!pid) {
        sendJson(res, 400, { error: 'Missing pid' });
        return;
      }

      try {
        const taskId = `proxy_${Date.now()}`;
        const headersList = getPixivHeaders();
        const proxy = new PixivProxy(headersList[0], logManager, taskId, db);
        const result = await proxy.proxyImage(pid, targetSize);

        if (!result.success) {
          sendJson(res, 404, { error: result.error || 'Image not found' });
          return;
        }

        if (result.fromCache && result.b2Url) {
          res.writeHead(302, {
            Location: result.b2Url,
            'Access-Control-Allow-Origin': '*'
          });
          res.end();
          return;
        }

        if (!result.imageBuffer) {
          sendJson(res, 500, { error: 'Failed to load image buffer' });
          return;
        }

        res.writeHead(200, {
          'Content-Type': result.contentType || 'image/jpeg',
          'Content-Length': result.imageBuffer.length,
          'Cache-Control': 'public, max-age=86400',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(result.imageBuffer);

        (async () => {
          try {
            const downloadTaskId = `async_download_${pid}_${Date.now()}`;
            const downloader = new PixivDownloader(headersList[0], logManager, downloadTaskId, db);
            await downloader.downloadAndArchive(pid, targetSize);
            console.log(`[${downloadTaskId}] async archive done: ${pid}`);
          } catch (error) {
            console.error(`async archive failed for ${pid}:`, error);
          }
        })();
      } catch (error) {
        sendJson(res, 500, { error: 'Proxy request failed', message: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    default: {
      sendJson(res, 200, {
        service: 'Pixiv Crawler Tokyo Server',
        version: '1.0.0',
        database: 'Turso (libSQL)',
        scheduler: scheduler ? scheduler.getStatus() : { isRunning: false, tasks: [] },
        endpoints: {
          GET: [
            '?action=status',
            '?action=stats',
            '?action=env-check',
            '?action=get-pic&pid=xxx',
            '?action=random-pids&count=10',
            '?action=uncompleted-tasks&type=detail_info&limit=100',
            '?action=exists&pid=xxx',
            '?action=scheduler-status',
            '?action=scheduler-start',
            '?action=scheduler-stop',
            '?action=scheduler-trigger&task=home',
            '?action=illust-recommend-pids&pid=xxx&targetNum=30',
            '?action=author-recommend-pids&pid=xxx&targetNum=30',
            '?action=pid-detail-info&pid=xxx&threshold=0',
            '?action=home',
            '?action=daily|weekly|monthly',
            '?action=proxy&pid=xxx&size=original'
          ],
          POST: [
            '{action:"upsert-pic",pic:{...}}',
            '{action:"batch-tasks",pids:[...]}',
            '{action:"update-task-status",pid,taskType,count}',
            '{action:"batch-exists",pids:[...]}',
            '{action:"batch-detail-info",pids:[...],threshold}',
            '{action:"crawl-uncompleted",taskType,limit,threshold}',
            '{action:"auto-topn-preview",limit,minPopularity,sizes,dryRun}',
            '{action:"batch-download",pids:[...],sizes:[...]}'
          ]
        }
      });
      return;
    }
  }
}

async function handlePostAction(body: Record<string, any>, res: http.ServerResponse, db: TursoService) {
  const action = body.action;

  switch (action) {
    case 'upsert-pic': {
      if (!body.pic || !body.pic.pid) {
        sendJson(res, 400, { error: 'Missing pic.pid' });
        return;
      }
      await db.upsertPic(body.pic);
      sendJson(res, 200, { success: true, message: 'Pic upsert success', pid: body.pic.pid });
      return;
    }

    case 'batch-tasks': {
      if (!body.pids || !Array.isArray(body.pids)) {
        sendJson(res, 400, { error: 'Missing pids array' });
        return;
      }

      await db.batchCreatePicTasks(body.pids, {
        priority: Number.isFinite(parseInt(String(body.priority), 10)) ? parseInt(String(body.priority), 10) : undefined,
        sourceType: typeof body.sourceType === 'string' ? body.sourceType as any : undefined,
        sourceKey: typeof body.sourceKey === 'string' ? body.sourceKey : undefined,
        sourceRecentAt: typeof body.sourceRecentAt === 'string' ? body.sourceRecentAt : undefined
      });

      sendJson(res, 200, { success: true, message: 'Batch tasks created', count: body.pids.length });
      return;
    }

    case 'update-task-status': {
      const { pid, taskType, count } = body;
      if (!pid || !isTaskType(taskType)) {
        sendJson(res, 400, { error: 'Missing pid or invalid taskType' });
        return;
      }

      if (taskType === 'illust_recommend') {
        await db.updateIllustRecommendStatus(pid, count || 0);
      } else if (taskType === 'author_recommend') {
        await db.updateAuthorRecommendStatus(pid, count || 0);
      } else {
        await db.updateDetailInfoStatus(pid);
      }

      sendJson(res, 200, { success: true, message: 'Task status updated', pid, taskType });
      return;
    }

    case 'batch-exists': {
      if (!body.pids || !Array.isArray(body.pids)) {
        sendJson(res, 400, { error: 'Missing pids array' });
        return;
      }

      const existingPids = await db.getExistingPids(body.pids);
      sendJson(res, 200, {
        success: true,
        existingPids: Array.from(existingPids),
        existingCount: existingPids.size,
        totalChecked: body.pids.length
      });
      return;
    }

    case 'batch-detail-info': {
      if (!body.pids || !Array.isArray(body.pids)) {
        sendJson(res, 400, { error: 'Missing pids array' });
        return;
      }

      const pids = body.pids as string[];
      const threshold = parseFloat(body.threshold || '0');
      const taskId = `batch_detail_${Date.now()}`;

      sendJson(res, 200, {
        success: true,
        message: 'Batch detail task started',
        count: pids.length,
        threshold,
        taskId,
        timestamp: new Date().toISOString()
      });

      (async () => {
        try {
          const headersList = getPixivHeaders();
          const crawler = new PixivCrawler('0', headersList, logManager, taskId, threshold, db);
          const successCount = await crawler.batchGetPidDetailInfo(pids);
          console.log(`[${taskId}] batch detail done: ${successCount}/${pids.length}`);
        } catch (error) {
          console.error(`[${taskId}] batch detail failed:`, error);
        }
      })();
      return;
    }

    case 'crawl-uncompleted': {
      const taskType = body.taskType as string | undefined;
      const limit = parseInt(String(body.limit || '50'), 10);
      const threshold = parseFloat(String(body.threshold || '0'));
      if (!isTaskType(taskType)) {
        sendJson(res, 400, { error: 'Invalid taskType' });
        return;
      }

      const taskId = `crawl_${taskType}_${Date.now()}`;
      const uncompletedPids = await db.getUncompletedTasks(taskType, limit);
      if (uncompletedPids.length === 0) {
        sendJson(res, 200, { success: true, message: 'No uncompleted tasks', taskType, count: 0, taskId, timestamp: new Date().toISOString() });
        return;
      }

      sendJson(res, 200, {
        success: true,
        message: `Start processing ${uncompletedPids.length} ${taskType} tasks`,
        taskType,
        count: uncompletedPids.length,
        taskId,
        timestamp: new Date().toISOString()
      });

      (async () => {
        try {
          const headersList = getPixivHeaders();
          let successCount = 0;

          for (const pid of uncompletedPids) {
            try {
              const crawler = new PixivCrawler(pid, headersList, logManager, taskId, threshold, db);
              if (taskType === 'illust_recommend') {
                await crawler.getIllustRecommendPids(pid, 30);
              } else if (taskType === 'author_recommend') {
                await crawler.getAuthorRecommendPids(pid, 30);
              } else {
                await crawler.getPidDetailInfo(pid);
              }
              successCount += 1;
            } catch (error) {
              console.error(`[${taskId}] failed to process ${pid}:`, error);
              await db.markTaskAttemptFailed(pid, error instanceof Error ? error.message : String(error), taskType === 'detail_info' ? 20 : 45);
            }
          }

          console.log(`[${taskId}] crawl-uncompleted done: ${successCount}/${uncompletedPids.length}`);
        } catch (error) {
          console.error(`[${taskId}] crawl-uncompleted failed:`, error);
        }
      })();
      return;
    }

    case 'auto-topn-preview': {
      const defaultLimit = parseInt(process.env.AUTO_PREVIEW_DEFAULT_LIMIT || '120', 10);
      const defaultMinPopularity = parseFloat(process.env.AUTO_PREVIEW_MIN_POPULARITY || '0');
      const defaultSizes = parseSizeList(
        process.env.AUTO_PREVIEW_SIZES || process.env.AUTO_PREVIEW_SIZE || 'thumb_mini,small',
        ['thumb_mini', 'small']
      );

      const requestedLimit = parseInt(String(body.limit ?? defaultLimit), 10);
      const requestedMinPopularity = parseFloat(String(body.minPopularity ?? defaultMinPopularity));
      const sizes = parseSizeList(body.sizes ?? body.size, defaultSizes);
      const dryRun = parseBooleanLike(body.dryRun);
      const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 500)) : defaultLimit;
      const minPopularity = Number.isFinite(requestedMinPopularity) ? requestedMinPopularity : defaultMinPopularity;
      const windowConfig = getAutoPreviewWindowConfig(body);
      const quotaConfig = getAutoPreviewQuotaConfig(body);

      const taskId = `auto_topn_preview_${Date.now()}`;
      const candidates = await db.getRecentPreviewCandidates(limit, minPopularity, windowConfig, quotaConfig);

      let enqueuedCount = 0;
      let claimedJobs = [] as Awaited<ReturnType<TursoService['claimPendingDownloadJobs']>>;

      if (!dryRun && candidates.length > 0) {
        enqueuedCount = await db.enqueueDownloadJobs(
          candidates.map(candidate => ({
            pid: candidate.pid,
            jobType: 'preview' as const,
            requestedSizes: sizes,
            priority: candidate.priority,
            sourceType: candidate.sourceType,
            sourceKey: candidate.sourceKey,
            maxAttempts: 3
          }))
        );
        claimedJobs = await db.claimPendingDownloadJobs('preview', limit);
      }

      sendJson(res, 200, {
        success: true,
        taskId,
        dryRun,
        sizes,
        limit,
        minPopularity,
        windows: windowConfig,
        quotas: quotaConfig,
        candidateCount: candidates.length,
        enqueuedCount,
        claimedCount: claimedJobs.length,
        candidatePreview: candidates.slice(0, 20).map(item => ({
          pid: item.pid,
          priority: item.priority,
          sourceType: item.sourceType,
          sourceRecentAt: item.sourceRecentAt,
          popularity: item.popularity,
          view: item.view
        })),
        timestamp: new Date().toISOString()
      });

      if (dryRun || claimedJobs.length === 0) {
        return;
      }

      (async () => {
        try {
          const headersList = getPixivHeaders();
          const downloader = new PixivDownloader(headersList[0], logManager, taskId, db);
          let successCount = 0;

          for (const job of claimedJobs) {
            try {
              const results = await downloader.downloadAndArchiveMultiSizes(job.pid, job.requested_sizes);
              const jobSuccess = results.some(result => result.success);
              if (jobSuccess) {
                await db.markDownloadJobSuccess(job.id);
                successCount += 1;
              } else {
                const errorMessage = results.map(result => result.error).filter(Boolean).join(' | ') || 'Preview archive failed';
                await db.markDownloadJobFailed(job.id, errorMessage);
              }
            } catch (error) {
              await db.markDownloadJobFailed(job.id, error instanceof Error ? error.message : String(error));
            }
          }

          console.log(`[${taskId}] auto preview jobs done: ${successCount}/${claimedJobs.length}`);
        } catch (error) {
          console.error(`[${taskId}] auto preview failed:`, error);
        }
      })();
      return;
    }

    case 'batch-download': {
      const pids = body.pids as string[];
      const sizes = parseSizeList(body.sizes ?? body.size, ['original']);
      if (!pids || !Array.isArray(pids) || pids.length === 0) {
        sendJson(res, 400, { error: 'Missing pids array' });
        return;
      }

      const taskId = `batch_download_${Date.now()}`;
      const headersList = getPixivHeaders();
      const downloader = new PixivDownloader(headersList[0], logManager, taskId, db);

      sendJson(res, 200, {
        success: true,
        message: 'Batch download task started',
        taskId,
        count: pids.length,
        sizes,
        timestamp: new Date().toISOString()
      });

      (async () => {
        try {
          const results = await downloader.batchDownloadAndArchiveMultiSizes(pids, sizes);
          const successCount = results.filter(result => result.success).length;
          console.log(`[${taskId}] batch download done: ${successCount}/${pids.length}`);
        } catch (error) {
          console.error(`[${taskId}] batch download failed:`, error);
        }
      })();
      return;
    }

    default: {
      sendJson(res, 400, { error: 'Unknown action' });
      return;
    }
  }
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = req.url || '/';
  const method = req.method || 'GET';
  const query = parseQueryParams(url);

  if (method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  try {
    const db = getDbService();
    if (method === 'GET') {
      await handleGetAction(query.action, query, res, db);
      return;
    }

    if (method === 'POST') {
      const body = await parseBody(req);
      await handlePostAction(body, res, db);
      return;
    }

    sendJson(res, 405, { error: `Method ${method} not allowed` });
  } catch (error) {
    console.error('request failed:', error);
    sendJson(res, 500, { error: 'Internal server error', message: error instanceof Error ? error.message : String(error) });
  }
}

const PORT = parseInt(process.env.PORT || '3000', 10);
const server = http.createServer((req, res) => {
  void handleRequest(req, res);
});

server.listen(PORT, () => {
  console.log('========================================');
  console.log('Pixiv Crawler Tokyo Server started');
  console.log(`Port: ${PORT}`);
  console.log('Database: Turso (libSQL)');
  console.log('========================================');

  const envCheck = checkEnvironmentVariables();
  if (!envCheck.valid) {
    console.warn(`Missing required env vars: ${envCheck.missing.join(', ')}`);
  } else {
    console.log('Environment variables look good');
  }

  try {
    getDbService();
    console.log('Database connection initialized');
  } catch (error) {
    console.error('Database connection init failed:', error);
  }

  try {
    scheduler = new TaskScheduler(PORT, logManager);
    scheduler.start();
    console.log('Scheduler started');
  } catch (error) {
    console.error('Scheduler init failed:', error);
  }
});

async function shutdown(signal: string) {
  console.log(`Received ${signal}, shutting down...`);

  if (scheduler) {
    scheduler.stop();
    console.log('Scheduler stopped');
  }

  if (dbService) {
    await dbService.close();
  }

  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
