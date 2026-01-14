import http from 'http';
import path from 'path';
import dotenv from 'dotenv';
import { TursoService } from './db/turso';
import { PixivCrawler, ConsoleLogManager } from './crawler';
import { PixivProxy, PixivDownloader } from './proxy';
import { TaskScheduler } from './scheduler';
import { checkEnvironmentVariables, checkB2Config, getPixivHeaders, CRAWLER_CONFIG } from './config';

// 加载环境变量 (优先加载 .env.local，然后加载 .env)
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config(); // 作为备选，加载 .env

// ========================================
// 全局实例
// ========================================

let dbService: TursoService | null = null;
let scheduler: TaskScheduler | null = null;
const logManager = new ConsoleLogManager();

/**
 * 获取数据库服务实例 (单例模式)
 */
function getDbService(): TursoService {
  if (!dbService) {
    dbService = new TursoService();
  }
  return dbService;
}

// ========================================
// HTTP 请求处理
// ========================================

/**
 * 解析查询参数
 */
function parseQueryParams(url: string): Record<string, string> {
  const params: Record<string, string> = {};
  const queryStart = url.indexOf('?');
  if (queryStart !== -1) {
    const queryString = url.substring(queryStart + 1);
    const pairs = queryString.split('&');
    for (const pair of pairs) {
      const [key, value] = pair.split('=');
      if (key) {
        params[decodeURIComponent(key)] = decodeURIComponent(value || '');
      }
    }
  }
  return params;
}

/**
 * 解析请求体
 */
async function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

/**
 * 发送 JSON 响应
 */
function sendJson(res: http.ServerResponse, statusCode: number, data: any) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

/**
 * 主请求处理器
 */
async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = req.url || '/';
  const method = req.method || 'GET';
  const query = parseQueryParams(url);
  const timestamp = new Date().toISOString();

  console.log(`[${timestamp}] ${method} ${url}`);

  // 处理 CORS 预检请求
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

    // GET 请求处理
    if (method === 'GET') {
      const action = query.action;

      switch (action) {
        case 'status':
          // 服务状态
          sendJson(res, 200, {
            status: 'running',
            timestamp: new Date().toISOString(),
            environment: 'tokyo-server',
            nodeVersion: process.version,
            platform: process.platform,
            database: 'turso'
          });
          break;

        case 'stats':
          // 统计信息
          const stats = await db.getStatsFromView();
          sendJson(res, 200, stats);
          break;

        case 'env-check':
          // 环境变量检查
          const envCheck = checkEnvironmentVariables();
          const b2Check = checkB2Config();
          sendJson(res, 200, {
            valid: envCheck.valid,
            missing: envCheck.missing,
            b2Valid: b2Check.valid,
            b2Missing: b2Check.missing,
            timestamp: new Date().toISOString()
          });
          break;

        case 'get-pic':
          // 获取图片信息
          const getPid = query.pid;
          if (!getPid) {
            sendJson(res, 400, { error: '缺少 pid 参数' });
            return;
          }
          const pic = await db.getPicByPid(getPid);
          if (pic) {
            sendJson(res, 200, { success: true, data: pic });
          } else {
            sendJson(res, 404, { success: false, error: '未找到指定的 PID' });
          }
          break;

        case 'random-pids':
          // 随机获取 PID
          const count = parseInt(query.count || '10');
          if (count <= 0 || count > 100) {
            sendJson(res, 400, { error: 'count 参数必须在 1-100 之间' });
            return;
          }
          const randomPids = await db.getRandomPids(count);
          sendJson(res, 200, {
            success: true,
            pids: randomPids,
            count: randomPids.length,
            timestamp: new Date().toISOString()
          });
          break;

        case 'uncompleted-tasks':
          // 获取未完成任务
          const taskType = query.type as 'illust_recommend' | 'author_recommend' | 'detail_info';
          const limit = parseInt(query.limit || '100');
          if (!['illust_recommend', 'author_recommend', 'detail_info'].includes(taskType)) {
            sendJson(res, 400, { error: '无效的 type 参数' });
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
          break;

        case 'exists':
          // 检查 PID 是否存在
          const checkPid = query.pid;
          if (!checkPid) {
            sendJson(res, 400, { error: '缺少 pid 参数' });
            return;
          }
          const exists = await db.existsPid(checkPid);
          sendJson(res, 200, { pid: checkPid, exists });
          break;

        // ========================================
        // 调度器相关 API
        // ========================================

        case 'scheduler-status':
          // 获取调度器状态
          if (scheduler) {
            sendJson(res, 200, {
              success: true,
              ...scheduler.getStatus(),
              timestamp: new Date().toISOString()
            });
          } else {
            sendJson(res, 200, {
              success: false,
              isRunning: false,
              message: '调度器未初始化',
              timestamp: new Date().toISOString()
            });
          }
          break;

        case 'scheduler-start':
          // 启动调度器
          if (scheduler) {
            scheduler.start();
            sendJson(res, 200, {
              success: true,
              message: '调度器已启动',
              timestamp: new Date().toISOString()
            });
          } else {
            sendJson(res, 500, { error: '调度器未初始化' });
          }
          break;

        case 'scheduler-stop':
          // 停止调度器
          if (scheduler) {
            scheduler.stop();
            sendJson(res, 200, {
              success: true,
              message: '调度器已停止',
              timestamp: new Date().toISOString()
            });
          } else {
            sendJson(res, 500, { error: '调度器未初始化' });
          }
          break;

        case 'scheduler-trigger':
          // 手动触发任务
          const triggerAction = query.task;
          if (!triggerAction) {
            sendJson(res, 400, { error: '缺少 task 参数' });
            return;
          }
          if (scheduler) {
            scheduler.triggerTask(triggerAction);
            sendJson(res, 200, {
              success: true,
              message: `已触发任务: ${triggerAction}`,
              timestamp: new Date().toISOString()
            });
          } else {
            sendJson(res, 500, { error: '调度器未初始化' });
          }
          break;

        // ========================================
        // 爬虫相关 API
        // ========================================

        case 'illust-recommend-pids': {
          // 获取插画推荐PID列表
          const pid = query.pid;
          const targetNum = parseInt(query.targetNum || '30');
          if (!pid) {
            sendJson(res, 400, { error: '缺少 pid 参数' });
            return;
          }
          try {
            const taskId = `illust_recommend_${pid}_${Date.now()}`;
            const headersList = getPixivHeaders();
            const crawler = new PixivCrawler(pid, headersList, logManager, taskId, 0, db);
            const recommendPids = await crawler.getIllustRecommendPids(pid, targetNum);
            sendJson(res, 200, {
              success: true,
              pid,
              targetNum,
              pids: recommendPids,
              count: recommendPids.length,
              taskId,
              timestamp: new Date().toISOString()
            });
          } catch (error) {
            sendJson(res, 500, {
              error: '获取插画推荐PID失败',
              message: error instanceof Error ? error.message : '未知错误'
            });
          }
          break;
        }

        case 'author-recommend-pids': {
          // 获取作者推荐PID列表
          const pid = query.pid;
          const targetNum = parseInt(query.targetNum || '30');
          if (!pid) {
            sendJson(res, 400, { error: '缺少 pid 参数' });
            return;
          }
          try {
            const taskId = `author_recommend_${pid}_${Date.now()}`;
            const headersList = getPixivHeaders();
            const crawler = new PixivCrawler(pid, headersList, logManager, taskId, 0, db);
            const recommendPids = await crawler.getAuthorRecommendPids(pid, targetNum);
            sendJson(res, 200, {
              success: true,
              pid,
              targetNum,
              pids: recommendPids,
              count: recommendPids.length,
              taskId,
              timestamp: new Date().toISOString()
            });
          } catch (error) {
            sendJson(res, 500, {
              error: '获取作者推荐PID失败',
              message: error instanceof Error ? error.message : '未知错误'
            });
          }
          break;
        }

        case 'pid-detail-info': {
          // 获取PID详细信息并入库
          const pid = query.pid;
          if (!pid) {
            sendJson(res, 400, { error: '缺少 pid 参数' });
            return;
          }
          try {
            const taskId = `detail_info_${pid}_${Date.now()}`;
            const threshold = parseFloat(query.threshold || '0');
            const headersList = getPixivHeaders();
            const crawler = new PixivCrawler(pid, headersList, logManager, taskId, threshold, db);
            const success = await crawler.getPidDetailInfo(pid);
            sendJson(res, 200, {
              success,
              pid,
              message: success ? 'PID详细信息获取并入库完成' : 'PID详细信息获取失败或跳过',
              taskId,
              timestamp: new Date().toISOString()
            });
          } catch (error) {
            sendJson(res, 500, {
              error: '获取PID详细信息失败',
              message: error instanceof Error ? error.message : '未知错误'
            });
          }
          break;
        }

        case 'home': {
          // 获取首页推荐PID并入库 pic_task
          try {
            const taskId = `home_${Date.now()}`;
            const headersList = getPixivHeaders();
            const crawler = new PixivCrawler('0', headersList, logManager, taskId, 0, db);
            const pids = await crawler.getHomeRecommendedPids();
            if (pids && pids.length > 0) {
              await db.batchCreatePicTasks(pids);
              sendJson(res, 200, {
                success: true,
                message: '首页推荐PID已入库 pic_task 表',
                count: pids.length,
                pids: pids.slice(0, 20), // 只返回前20个预览
                taskId,
                timestamp: new Date().toISOString()
              });
            } else {
              sendJson(res, 200, {
                success: false,
                message: '未提取到PID',
                count: 0,
                pids: [],
                taskId,
                timestamp: new Date().toISOString()
              });
            }
          } catch (error) {
            sendJson(res, 500, {
              error: '获取首页推荐失败',
              message: error instanceof Error ? error.message : '未知错误'
            });
          }
          break;
        }

        case 'daily':
        case 'weekly':
        case 'monthly': {
          // 获取排行榜
          const rankType = action as 'daily' | 'weekly' | 'monthly';
          try {
            const taskId = `${rankType}_${Date.now()}`;
            const headersList = getPixivHeaders();
            const crawler = new PixivCrawler('0', headersList, logManager, taskId, 0, db);
            const rankMethod = rankType === 'daily' ? crawler.getDailyRank :
                              rankType === 'weekly' ? crawler.getWeeklyRank :
                              crawler.getMonthlyRank;
            const result = await rankMethod.call(crawler);
            if (result && result.error === false) {
              const rankDate = new Date().toISOString().slice(0, 10);
              await db.upsertRankings(result.body.rankings, rankDate, rankType);
              sendJson(res, 200, {
                success: true,
                type: rankType,
                count: result.body.rankings.length,
                rankDate,
                taskId,
                timestamp: new Date().toISOString()
              });
            } else {
              sendJson(res, 200, {
                success: false,
                type: rankType,
                message: '获取排行榜失败或返回为空',
                taskId,
                timestamp: new Date().toISOString()
              });
            }
          } catch (error) {
            sendJson(res, 500, {
              error: `获取${rankType}排行榜失败`,
              message: error instanceof Error ? error.message : '未知错误'
            });
          }
          break;
        }

        // ========================================
        // 图片代理 API
        // ========================================
        case 'proxy': {
          // 智能图片代理：先查B2缓存，无则从Pixiv抓取
          const proxyPid = query.pid;
          const targetSize = query.size || 'original';

          if (!proxyPid) {
            sendJson(res, 400, { error: '缺少 pid 参数' });
            return;
          }

          try {
            const taskId = `proxy_${Date.now()}`;
            const headersList = getPixivHeaders();
            const proxy = new PixivProxy(headersList[0], logManager, taskId, db);

            const result = await proxy.proxyImage(proxyPid, targetSize);

            if (result.success) {
              if (result.fromCache && result.b2Url) {
                // B2缓存命中，重定向
                res.writeHead(302, { 'Location': result.b2Url });
                res.end();
              } else if (result.imageBuffer) {
                // 从Pixiv获取，直接返回图片
                res.writeHead(200, {
                  'Content-Type': result.contentType || 'image/jpeg',
                  'Content-Length': result.imageBuffer.length,
                  'Cache-Control': 'public, max-age=86400'
                });
                res.end(result.imageBuffer);

                // 异步触发下载归档到B2（不阻塞响应）
                (async () => {
                  try {
                    const downloadTaskId = `async_download_${proxyPid}_${Date.now()}`;
                    const downloader = new PixivDownloader(headersList[0], logManager, downloadTaskId, db);
                    await downloader.downloadAndArchive(proxyPid, targetSize);
                    console.log(`[${downloadTaskId}] 异步归档完成: ${proxyPid}`);
                  } catch (err) {
                    console.error(`异步归档失败 ${proxyPid}:`, err);
                  }
                })();
              } else {
                sendJson(res, 500, { error: '获取图片失败' });
              }
            } else {
              sendJson(res, 404, { error: result.error || '图片不存在' });
            }
          } catch (error) {
            sendJson(res, 500, {
              error: '代理请求失败',
              message: error instanceof Error ? error.message : '未知错误'
            });
          }
          break;
        }

        default:
          // 默认返回服务信息
          sendJson(res, 200, {
            service: 'Pixiv Crawler Tokyo Server',
            version: '1.0.0',
            database: 'Turso (libSQL)',
            scheduler: scheduler ? scheduler.getStatus() : { isRunning: false },
            endpoints: {
              GET: [
                '?action=status - 服务状态',
                '?action=stats - 统计信息',
                '?action=env-check - 环境变量检查',
                '?action=get-pic&pid=xxx - 获取图片信息',
                '?action=random-pids&count=10 - 随机获取PID',
                '?action=uncompleted-tasks&type=xxx&limit=100 - 获取未完成任务',
                '?action=exists&pid=xxx - 检查PID是否存在',
                '?action=scheduler-status - 调度器状态',
                '?action=scheduler-start - 启动调度器',
                '?action=scheduler-stop - 停止调度器',
                '?action=scheduler-trigger&task=xxx - 手动触发任务',
                '?action=illust-recommend-pids&pid=xxx&targetNum=30 - 获取插画推荐PID',
                '?action=author-recommend-pids&pid=xxx&targetNum=30 - 获取作者推荐PID',
                '?action=pid-detail-info&pid=xxx&threshold=0 - 获取PID详细信息并入库',
                '?action=home - 获取首页推荐PID',
                '?action=daily|weekly|monthly - 获取排行榜',
                '?action=proxy&pid=xxx&size=original - 图片代理'
              ],
              POST: [
                '{action: "upsert-pic", pic: {...}} - 插入或更新图片',
                '{action: "batch-tasks", pids: [...]} - 批量创建任务',
                '{action: "update-task-status", pid, taskType, count} - 更新任务状态',
                '{action: "batch-exists", pids: [...]} - 批量检查PID存在',
                '{action: "batch-detail-info", pids: [...], threshold} - 批量获取详细信息',
                '{action: "crawl-uncompleted", taskType, limit, threshold} - 爬取未完成任务',
                '{action: "batch-download", pids: [...], size} - 批量下载图片到B2'
              ]
            }
          });
      }
    }

    // POST 请求处理
    else if (method === 'POST') {
      const body = await parseBody(req);
      const action = body.action;

      switch (action) {
        case 'upsert-pic':
          // 插入或更新图片
          if (!body.pic || !body.pic.pid) {
            sendJson(res, 400, { error: '缺少 pic 数据或 pid' });
            return;
          }
          await db.upsertPic(body.pic);
          sendJson(res, 200, { success: true, message: 'Pic upsert 成功', pid: body.pic.pid });
          break;

        case 'batch-tasks':
          // 批量创建任务
          if (!body.pids || !Array.isArray(body.pids)) {
            sendJson(res, 400, { error: '缺少 pids 数组' });
            return;
          }
          await db.batchCreatePicTasks(body.pids);
          sendJson(res, 200, { success: true, message: '批量任务创建成功', count: body.pids.length });
          break;

        case 'update-task-status':
          // 更新任务状态
          const { pid, taskType, count: taskCount } = body;
          if (!pid || !taskType) {
            sendJson(res, 400, { error: '缺少 pid 或 taskType' });
            return;
          }
          if (taskType === 'illust_recommend') {
            await db.updateIllustRecommendStatus(pid, taskCount || 0);
          } else if (taskType === 'author_recommend') {
            await db.updateAuthorRecommendStatus(pid, taskCount || 0);
          } else if (taskType === 'detail_info') {
            await db.updateDetailInfoStatus(pid);
          } else {
            sendJson(res, 400, { error: '无效的 taskType' });
            return;
          }
          sendJson(res, 200, { success: true, message: '任务状态更新成功', pid, taskType });
          break;

        case 'batch-exists':
          // 批量检查 PID 是否存在
          if (!body.pids || !Array.isArray(body.pids)) {
            sendJson(res, 400, { error: '缺少 pids 数组' });
            return;
          }
          const existingPids = await db.getExistingPids(body.pids);
          sendJson(res, 200, {
            success: true,
            existingPids: Array.from(existingPids),
            existingCount: existingPids.size,
            totalChecked: body.pids.length
          });
          break;

        // ========================================
        // 爬虫相关 POST API
        // ========================================

        case 'batch-detail-info': {
          // 批量获取PID详细信息并入库
          if (!body.pids || !Array.isArray(body.pids)) {
            sendJson(res, 400, { error: '缺少 pids 数组' });
            return;
          }
          const pids = body.pids as string[];
          const threshold = parseFloat(body.threshold || '0');
          const taskId = `batch_detail_${Date.now()}`;

          // 先返回响应，然后异步执行
          sendJson(res, 200, {
            success: true,
            message: '批量获取详细信息任务已启动',
            count: pids.length,
            threshold,
            taskId,
            timestamp: new Date().toISOString()
          });

          // 异步执行批量爬取
          (async () => {
            try {
              const headersList = getPixivHeaders();
              const crawler = new PixivCrawler('0', headersList, logManager, taskId, threshold, db);
              const successCount = await crawler.batchGetPidDetailInfo(pids);
              console.log(`[${taskId}] 批量任务完成，成功: ${successCount}/${pids.length}`);
            } catch (error) {
              console.error(`[${taskId}] 批量任务失败:`, error);
            }
          })();
          break;
        }

        case 'crawl-uncompleted': {
          // 爬取未完成的任务
          const taskType = body.taskType as 'illust_recommend' | 'author_recommend' | 'detail_info';
          const limit = parseInt(body.limit || '50');
          const threshold = parseFloat(body.threshold || '0');

          if (!['illust_recommend', 'author_recommend', 'detail_info'].includes(taskType)) {
            sendJson(res, 400, { error: '无效的 taskType' });
            return;
          }

          const taskId = `crawl_${taskType}_${Date.now()}`;
          const uncompletedPids = await db.getUncompletedTasks(taskType, limit);

          if (uncompletedPids.length === 0) {
            sendJson(res, 200, {
              success: true,
              message: '没有未完成的任务',
              taskType,
              count: 0,
              taskId,
              timestamp: new Date().toISOString()
            });
            return;
          }

          // 先返回响应，然后异步执行
          sendJson(res, 200, {
            success: true,
            message: `开始处理 ${uncompletedPids.length} 个未完成的 ${taskType} 任务`,
            taskType,
            count: uncompletedPids.length,
            taskId,
            timestamp: new Date().toISOString()
          });

          // 异步执行
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
                  } else if (taskType === 'detail_info') {
                    await crawler.getPidDetailInfo(pid);
                  }
                  successCount++;
                } catch (error) {
                  console.error(`[${taskId}] 处理 ${pid} 失败:`, error);
                }
              }

              console.log(`[${taskId}] 任务完成，成功: ${successCount}/${uncompletedPids.length}`);
            } catch (error) {
              console.error(`[${taskId}] 任务失败:`, error);
            }
          })();
          break;
        }

        case 'batch-download': {
          // 批量下载图片到B2
          const pids = body.pids as string[];
          const size = body.size || 'original';

          if (!pids || !Array.isArray(pids) || pids.length === 0) {
            sendJson(res, 400, { error: '缺少 pids 数组参数' });
            return;
          }

          const taskId = `batch_download_${Date.now()}`;
          const headersList = getPixivHeaders();
          const downloader = new PixivDownloader(headersList[0], logManager, taskId, db);

          // 先返回响应
          sendJson(res, 200, {
            success: true,
            message: '批量下载任务已启动',
            taskId,
            count: pids.length,
            timestamp: new Date().toISOString()
          });

          // 异步执行下载
          (async () => {
            try {
              const results = await downloader.batchDownloadAndArchive(pids, size);
              const successCount = results.filter(r => r.success).length;
              console.log(`[${taskId}] 批量下载完成: ${successCount}/${pids.length}`);
            } catch (error) {
              console.error(`[${taskId}] 批量下载失败:`, error);
            }
          })();
          break;
        }

        default:
          sendJson(res, 400, { error: '未知的 action' });
      }
    }

    else {
      sendJson(res, 405, { error: `方法 ${method} 不允许` });
    }

  } catch (error) {
    console.error('请求处理错误:', error);
    sendJson(res, 500, {
      error: '服务器内部错误',
      message: error instanceof Error ? error.message : '未知错误'
    });
  }
}

// ========================================
// 服务器启动
// ========================================

const PORT = parseInt(process.env.PORT || '3000');

const server = http.createServer(handleRequest);

server.listen(PORT, () => {
  console.log('========================================');
  console.log('🚀 Pixiv 爬虫东京服务器已启动');
  console.log(`📡 监听端口: ${PORT}`);
  console.log(`🗄️  数据库: Turso (libSQL)`);
  console.log('========================================');

  // 检查环境变量
  const envCheck = checkEnvironmentVariables();
  if (!envCheck.valid) {
    console.warn('⚠️  警告: 缺少以下环境变量:', envCheck.missing.join(', '));
  } else {
    console.log('✅ 环境变量检查通过');
  }

  // 尝试初始化数据库连接
  try {
    const db = getDbService();
    console.log('✅ 数据库连接已建立');
  } catch (error) {
    console.error('❌ 数据库连接失败:', error);
  }

  // 初始化并启动调度器
  try {
    scheduler = new TaskScheduler(PORT, logManager);
    scheduler.start();
    console.log('✅ 任务调度器已启动');
  } catch (error) {
    console.error('❌ 任务调度器启动失败:', error);
  }
});

// 优雅关闭
process.on('SIGTERM', async () => {
  console.log('收到 SIGTERM 信号，正在关闭服务器...');

  // 停止调度器
  if (scheduler) {
    scheduler.stop();
    console.log('调度器已停止');
  }

  if (dbService) {
    await dbService.close();
  }
  server.close(() => {
    console.log('服务器已关闭');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('收到 SIGINT 信号，正在关闭服务器...');

  // 停止调度器
  if (scheduler) {
    scheduler.stop();
    console.log('调度器已停止');
  }

  if (dbService) {
    await dbService.close();
  }
  server.close(() => {
    console.log('服务器已关闭');
    process.exit(0);
  });
});
