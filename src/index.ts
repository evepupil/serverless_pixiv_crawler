// 适配 Vercel 与 Cloudflare Workers 环境类型
import { VercelRequest, VercelResponse } from '@vercel/node';
import { PixivCrawler } from './services/pixiv-crawler';
import { PixivDownloader } from './services/pixiv-downloader';
import { getPixivHeaders, getR2Config, checkEnvironmentVariables, checkR2Config } from './config';
import { SupabaseService } from './database/supabase';
import * as fs from 'fs';
import * as path from 'path';

// 全局日志存储
interface LogEntry {
  id: string;
  timestamp: string;
  message: string;
  type: 'info' | 'error' | 'warning' | 'success';
  taskId?: string;
}

class LogManager {
  private logs: LogEntry[] = [];
  private maxLogs = 1000; // 最多保存1000条日志
  private logFile = '/tmp/pixiv_crawler_logs.json'; // 临时文件路径

  constructor() {
    this.loadLogsFromFile();
  }

  /**
   * 从文件加载日志
   */
  private loadLogsFromFile(): void {
    try {
      if (fs.existsSync(this.logFile)) {
        const data = fs.readFileSync(this.logFile, 'utf8');
        const savedLogs = JSON.parse(data);
        if (Array.isArray(savedLogs)) {
          // 只加载最近1小时的日志
          const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
          this.logs = savedLogs.filter(log => new Date(log.timestamp) > oneHourAgo);
        }
      }
    } catch (error) {
      console.warn('加载日志文件失败:', error);
      this.logs = [];
    }
  }

  /**
   * 保存日志到文件
   */
  private saveLogsToFile(): void {
    try {
      // 确保目录存在
      const dir = path.dirname(this.logFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      // 只保存最近的日志
      const logsToSave = this.logs.slice(-this.maxLogs);
      fs.writeFileSync(this.logFile, JSON.stringify(logsToSave, null, 2));
    } catch (error) {
      console.warn('保存日志文件失败:', error);
    }
  }

  addLog(message: string, type: LogEntry['type'] = 'info', taskId?: string): void {
    const logEntry: LogEntry = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toISOString(),
      message,
      type,
      taskId
    };

    this.logs.push(logEntry);

    // 保持日志数量在限制内
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }

    // 同时输出到控制台
    console.log('[' + logEntry.timestamp + '] [' + type.toUpperCase() + '] ' + message);

    // 异步保存到文件（避免阻塞）
    setImmediate(() => {
      this.saveLogsToFile();
    });
  }

  getLogs(taskId?: string, limit: number = 100): LogEntry[] {
    // 先尝试从文件重新加载最新日志
    this.loadLogsFromFile();
    
    let filteredLogs = this.logs;
    if (taskId) {
      filteredLogs = this.logs.filter(log => log.taskId === taskId);
    }
    return filteredLogs.slice(-limit);
  }

  clearLogs(): void {
    this.logs = [];
    try {
      if (fs.existsSync(this.logFile)) {
        fs.unlinkSync(this.logFile);
      }
    } catch (error) {
      console.warn('删除日志文件失败:', error);
    }
  }
}

// 榜单爬虫函数（按类型）
async function runRanking(type: 'daily' | 'weekly' | 'monthly', taskId?: string): Promise<void> {
  if (!taskId) {
    taskId = type + '_' + new Date().toISOString().slice(0, 10) + '_' + Date.now();
  }

  try {
    logManager.addLog(`开始获取Pixiv${type}排行榜`, 'info', taskId);
    const headersList = getPixivHeaders();
    const pixivCrawler = new PixivCrawler('0', headersList, logManager, taskId, 0.0);

    const res = type === 'daily' ? await pixivCrawler.getDailyRank() : (type === 'weekly' ? await pixivCrawler.getWeeklyRank() : await pixivCrawler.getMonthlyRank());
    if (res && res.error === false) {
      const rankings = res.body.rankings;
      const rankDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const supabase = new SupabaseService();
      await supabase.upsertRankings(rankings, rankDate, type);
      logManager.addLog(`${type} 排行榜入库完成，共 ${rankings.length} 条`, 'success', taskId);
    } else {
      logManager.addLog(`获取${type}排行榜失败或返回为空`, 'warning', taskId);
    }
  } catch (error) {
    logManager.addLog(`${type} 排行榜任务失败: ` + (error instanceof Error ? error.message : String(error)), 'error', taskId);
    throw error;
  }
}

// 全局日志管理器实例
const logManager = new LogManager();

/**
 * 获取内联HTML内容（当模板文件无法加载时的备用方案）
 * @returns {string} HTML内容
 */
function getInlineHTML(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Pixiv 爬虫服务</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; }
        .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
        .header { text-align: center; color: white; margin-bottom: 30px; }
        .card { background: white; border-radius: 12px; padding: 24px; margin-bottom: 20px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
        .status-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 20px; }
        .status-item { text-align: center; padding: 16px; background: #f8f9fa; border-radius: 8px; }
        .btn { background: #007bff; color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; font-size: 16px; }
        .btn:hover { background: #0056b3; }
        .log-panel { background: #1a1a1a; color: #00ff00; padding: 16px; border-radius: 8px; height: 300px; overflow-y: auto; font-family: monospace; }
        .alert { padding: 12px; margin: 10px 0; border-radius: 6px; }
        .alert.error { background: #f8d7da; color: #721c24; }
        .alert.success { background: #d4edda; color: #155724; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎨 Pixiv 爬虫服务</h1>
            <p>基于 Serverless 架构的 Pixiv 插画爬虫系统</p>
        </div>
        
        <div class="card">
            <h3>📊 系统状态</h3>
            <div class="status-grid">
                <div class="status-item">
                    <h4>服务状态</h4>
                    <div id="status-value">检查中...</div>
                </div>
                <div class="status-item">
                    <h4>环境变量</h4>
                    <div id="env-status">检查中...</div>
                </div>
                <div class="status-item">
                    <h4>总图片数</h4>
                    <div id="total-pics">0</div>
                </div>
                <div class="status-item">
                    <h4>已下载</h4>
                    <div id="downloaded-pics">0</div>
                </div>
            </div>
            <button class="btn" onclick="refreshStatus()">🔄 刷新状态</button>
        </div>
        
        <div class="card">
            <h3>📥 下载功能</h3>
            <div style="margin-bottom: 20px;">
                <div style="display: flex; gap: 10px; margin-bottom: 10px;">
                    <input type="text" id="download-pid" placeholder="输入PID" style="flex: 1; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                    <button class="btn" onclick="downloadSingle()">下载单个</button>
                </div>
                <div style="display: flex; gap: 10px;">
                    <textarea id="download-pids" placeholder="输入多个PID，每行一个" style="flex: 1; padding: 8px; border: 1px solid #ddd; border-radius: 4px; height: 80px; resize: vertical;"></textarea>
                    <button class="btn" onclick="downloadBatch()">批量下载</button>
                </div>
            </div>
        </div>
        
        <div class="card">
            <h3>📝 实时日志</h3>
            <div class="log-panel" id="log-content">
                <div>[系统] 等待日志输出...</div>
            </div>
        </div>
    </div>

    <script>
        // 检测是否在Vercel环境中，如果是则使用/api路径
        const isVercel = window.location.hostname.includes('vercel.app');
        const API_BASE = isVercel ? window.location.origin + '/api' : window.location.origin;
        
        document.addEventListener('DOMContentLoaded', function() {
            refreshStatus();
            addLog('页面加载完成，系统就绪', 'info');
        });

        async function downloadSingle() {
            const pid = document.getElementById('download-pid').value.trim();
            if (!pid) {
                addLog('请输入PID', 'error');
                return;
            }
            
            addLog('开始下载单个图片: ' + pid, 'info');
            
            try {
                const response = await fetch(API_BASE, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'download',
                        downloadPid: pid
                    })
                });
                
                const data = await response.json();
                if (response.ok) {
                    addLog('下载任务已启动: ' + data.message, 'success');
                    addLog('任务ID: ' + data.taskId, 'info');
                } else {
                    addLog('下载任务启动失败: ' + data.error, 'error');
                }
            } catch (error) {
                addLog('下载请求失败: ' + error.message, 'error');
            }
        }

        async function downloadBatch() {
            const pidsText = document.getElementById('download-pids').value.trim();
            if (!pidsText) {
                addLog('请输入PID列表', 'error');
                return;
            }
            
            const pids = pidsText.split('\\n').map(pid => pid.trim()).filter(pid => pid);
            if (pids.length === 0) {
                addLog('没有有效的PID', 'error');
                return;
            }
            
            addLog('开始批量下载 ' + pids.length + ' 张图片', 'info');
            
            try {
                const response = await fetch(API_BASE, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'download',
                        downloadPids: pids
                    })
                });
                
                const data = await response.json();
                if (response.ok) {
                    addLog('批量下载任务已启动: ' + data.message, 'success');
                    addLog('任务ID: ' + data.taskId, 'info');
                } else {
                    addLog('批量下载任务启动失败: ' + data.error, 'error');
                }
            } catch (error) {
                addLog('批量下载请求失败: ' + error.message, 'error');
            }
        }

        function addLog(message, type = 'info') {
            const logContent = document.getElementById('log-content');
            const timestamp = new Date().toLocaleTimeString();
            const logEntry = document.createElement('div');
            logEntry.textContent = '[' + timestamp + '] ' + message;
            logContent.appendChild(logEntry);
            logContent.scrollTop = logContent.scrollHeight;
        }

        async function refreshStatus() {
            try {
                const response = await fetch(API_BASE + '/?action=status');
                const data = await response.json();
                
                if (data.status === 'running') {
                    document.getElementById('status-value').textContent = '运行中';
                    document.getElementById('status-value').style.color = '#28a745';
                }

                const envResponse = await fetch(API_BASE + '/?action=env-check');
                const envData = await envResponse.json();
                const envStatusElement = document.getElementById('env-status');
                if (envData.valid) {
                    envStatusElement.textContent = '✅ 正常';
                    envStatusElement.style.color = '#28a745';
                } else {
                    envStatusElement.textContent = '❌ 异常';
                    envStatusElement.style.color = '#dc3545';
                }
            } catch (error) {
                document.getElementById('env-status').textContent = '检查失败';
                document.getElementById('env-status').style.color = '#ffc107';
                addLog('状态刷新失败: ' + error.message, 'error');
            }

            try {
                const statsResponse = await fetch(API_BASE + '/?action=stats');
                const statsData = await statsResponse.json();
                document.getElementById('total-pics').textContent = statsData.totalPics || 0;
                document.getElementById('downloaded-pics').textContent = statsData.downloadedPics || 0;
            } catch (error) {
                addLog('统计信息获取失败: ' + error.message, 'error');
            }
        }
    </script>
</body>
</html>`;
}

// 检查环境变量
function checkEnvVariables(): boolean {
  const envCheck = checkEnvironmentVariables();
  if (!envCheck.valid) {
    console.warn('Missing environment variables:', envCheck.missing);
    return false;
  }
  return true;
}

// 安全的数据库操作包装器
async function safeDatabaseOperation<T>(operation: () => Promise<T>, defaultValue: T): Promise<T> {
  try {
    if (!checkEnvironmentVariables()) {
      return defaultValue;
    }
    return await operation();
  } catch (error) {
    console.error('Database operation failed:', error);
    return defaultValue;
  }
}

// 主爬虫函数
async function runCrawler(pid: string, targetNum: number = 1000, popularityThreshold: number = 0.22, taskId?: string): Promise<void> {
  // 如果没有提供taskId，则生成一个新的
  if (!taskId) {
    taskId = 'single_' + pid + '_' + Date.now();
  }
  
  try {
    logManager.addLog(`开始爬取Pixiv插画，起始PID: ${pid}，目标数量: ${targetNum}，热度阈值: ${popularityThreshold}`, 'info', taskId);
    
    const headersList = getPixivHeaders();
    const pixivCrawler = new PixivCrawler(pid, headersList, logManager, taskId, popularityThreshold);
    
    logManager.addLog('爬虫初始化完成，使用 ' + headersList.length + ' 个请求头', 'info', taskId);
    await pixivCrawler.getPidsFromOriginPid(pid, targetNum);
    
    logManager.addLog('爬取完成，起始PID: ' + pid, 'success', taskId);
    
  } catch (error) {
    logManager.addLog('爬取失败，起始PID: ' + pid + '，错误: ' + (error instanceof Error ? error.message : String(error)), 'error', taskId);
    throw error;
  }
}

// 批量爬虫函数
async function batchCrawl(pids: string[], targetNum: number = 1000, popularityThreshold: number = 0.22, taskId?: string): Promise<void> {
  // 如果没有提供taskId，则生成一个新的
  if (!taskId) {
    taskId = 'batch_' + Date.now();
  }
  
  try {
    logManager.addLog(`开始批量爬取，共${pids.length}个PID，目标数量: ${targetNum}，热度阈值: ${popularityThreshold}`, 'info', taskId);
    
    for (let i = 0; i < pids.length; i++) {
      const pid = pids[i];
      try {
        logManager.addLog('处理第 ' + (i + 1) + '/' + pids.length + ' 个PID: ' + pid, 'info', taskId);
        // 为每个PID创建子任务ID，但仍然使用主TaskID记录日志
        const subTaskId = taskId + '_' + pid;
        await runCrawler(pid, targetNum, popularityThreshold, subTaskId);
        logManager.addLog('PID ' + pid + ' 爬取完成', 'success', taskId);
      } catch (error) {
        logManager.addLog('PID ' + pid + ' 爬取失败: ' + (error instanceof Error ? error.message : String(error)), 'error', taskId);
      }
    }
    
    logManager.addLog(`批量爬取结束，共处理${pids.length}个PID`, 'success', taskId);
  } catch (error) {
    logManager.addLog('批量爬取失败: ' + (error instanceof Error ? error.message : String(error)), 'error', taskId);
    throw error;
  }
}

// 导出 Vercel 处理器
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const { method } = req;
    const timestamp = new Date().toISOString();
    
    // 设置CORS头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (method === 'OPTIONS') {
      res.status(200).end();
      return;
    }

    switch (method) {
      case 'GET':
        const action = req.query.action as string;
        console.log(`[${timestamp}] GET请求 - action: ${action || 'default'}, query:`, req.query);
        
        if (action === 'status') {
          // 返回服务状态
          try {
            console.log(`[${timestamp}] 处理status API请求`);
            const statusData = { 
              status: 'running', 
              timestamp: new Date().toISOString(),
              environment: 'vercel',
              nodeVersion: process.version,
              platform: process.platform,
              envVarsCheck: {
                supabaseUrl: !!process.env.SUPABASE_URL,
                supabaseKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
                pixivCookie: !!process.env.PIXIV_COOKIE
              }
            };
            console.log(`[${timestamp}] Status API响应:`, statusData);
            res.status(200).json(statusData);
          } catch (error) {
            console.error('Status API error:', error);
            res.status(500).json({ error: 'Status check failed', details: error instanceof Error ? error.message : String(error) });
          }
        } else if (action === 'stats') {
          // 返回统计信息
          try {
            console.log(`[${timestamp}] 处理stats API请求`);
            const stats = await safeDatabaseOperation(async () => {
              const supabase = new SupabaseService();
              return await supabase.getStatsFromView();
            }, { totalPics: 0, downloadedPics: 0, avgPopularity: 0 });
            
            console.log(`[${timestamp}] Stats API响应:`, stats);
            res.status(200).json(stats);
          } catch (error) {
            console.error('Stats API error:', error);
            res.status(200).json({ totalPics: 0, downloadedPics: 0, avgPopularity: 0, error: 'Database unavailable' });
          }
        } else if (action === 'env-check') {
          // 检查环境变量
          console.log(`[${timestamp}] 处理env-check API请求`);
          const envCheck = checkEnvironmentVariables();
          const r2Check = checkR2Config();
          const response = { 
            valid: envCheck.valid, 
            missing: envCheck.missing, 
            r2Valid: r2Check.valid,
            r2Missing: r2Check.missing,
            features: {
              crawler: envCheck.valid,
              download: envCheck.valid && r2Check.valid
            },
            timestamp: new Date().toISOString() 
          };
          console.log(`[${timestamp}] Env-check API响应:`, response);
          res.status(200).json(response);
        } else if (action === 'logs') {
          // 获取日志
          const taskId = req.query.taskId as string;
          const limit = parseInt(req.query.limit as string) || 100;
          console.log(`[${timestamp}] 处理logs API请求 - taskId: ${taskId}, limit: ${limit}`);
          const logs = logManager.getLogs(taskId, limit);
          console.log(`[${timestamp}] Logs API响应: 返回${logs.length}条日志`);
          res.status(200).json(logs);
        } else if (action === 'get-pic') {
          // 获取指定PID的图片信息
          const pid = req.query.pid as string;
          console.log(`[${timestamp}] 处理get-pic API请求 - pid: ${pid}`);
          if (!pid) {
            console.log(`[${timestamp}] Get-pic API错误: 缺少PID参数`);
            res.status(400).json({ error: '缺少PID参数' });
            return;
          }
          
          try {
            const supabase = new SupabaseService();
            const picData = await supabase.getPicByPid(pid);
            if (picData) {
              console.log(`[${timestamp}] Get-pic API响应: 成功找到PID ${pid}的数据`);
              res.status(200).json({ success: true, data: picData });
            } else {
              console.log(`[${timestamp}] Get-pic API响应: 未找到PID ${pid}`);
              res.status(404).json({ success: false, error: '未找到指定的PID' });
            }
          } catch (error) {
            console.error(`[${timestamp}] Get-pic API错误:`, error);
            res.status(500).json({ success: false, error: '数据库查询失败' });
          }
        } else if (action === 'home') {
          // 获取首页推荐 PID 并最小化入库
          console.log(`[${timestamp}] 处理home API请求`);
          const headersList = getPixivHeaders();
          const taskId = 'home_' + Date.now();
          const crawler = new PixivCrawler('0', headersList, logManager, taskId, 0);
          const pids = await crawler.getHomeRecommendedPids();
          if (pids && pids.length > 0) {
            console.log(`[${timestamp}] Home API: 获取到${pids.length}个首页推荐PID`);
            const supabase = new SupabaseService();
            await supabase.upsertMinimalPics(pids);
            const response = { message: '首页推荐已入库', count: pids.length, pids, taskId };
            console.log(`[${timestamp}] Home API响应:`, response);
            res.status(200).json(response);
          } else {
            console.log(`[${timestamp}] Home API: 未提取到PID`);
            const response = { message: '未提取到PID', count: 0, pids: [], taskId };
            console.log(`[${timestamp}] Home API响应:`, response);
            res.status(200).json(response);
          }
        } else if (action === 'random-pids') {
          // 从数据库随机获取指定数量的pid
          const count = parseInt(req.query.count as string) || 10;
          console.log(`[${timestamp}] 处理random-pids API请求 - count: ${count}`);
          if (count <= 0 || count > 100) {
            console.log(`[${timestamp}] Random-pids API错误: count参数超出范围 (${count})`);
            res.status(400).json({ error: 'count参数必须在1-100之间' });
            return;
          }
          
          try {
            const supabase = new SupabaseService();
            const pids = await supabase.getRandomPids(count);
            const response = { 
              message: '随机PID获取成功', 
              count: pids.length, 
              pids, 
              timestamp: new Date().toISOString() 
            };
            console.log(`[${timestamp}] Random-pids API响应: 成功获取${pids.length}个随机PID`);
            res.status(200).json(response);
          } catch (error) {
            console.error(`[${timestamp}] Random-pids API错误:`, error);
            res.status(500).json({ 
              error: '随机获取PID失败', 
              message: error instanceof Error ? error.message : '未知错误' 
            });
          }
        } else if (action === 'illust-recommend-pids') {
          // 获取插画推荐PID列表
          const pid = req.query.pid as string;
          const targetNum = parseInt(req.query.targetNum as string) || 30;
          console.log(`[${timestamp}] 处理illust-recommend-pids API请求 - pid: ${pid}, targetNum: ${targetNum}`);
          
          if (!pid) {
            console.log(`[${timestamp}] Illust-recommend-pids API错误: 缺少PID参数`);
            res.status(400).json({ error: '缺少PID参数' });
            return;
          }
          
          try {
            const taskId = 'illust_recommend_' + pid + '_' + Date.now();
            logManager.addLog(`收到插画推荐PID获取请求: ${pid}，目标数量: ${targetNum}`, 'info', taskId);
            
            const headersList = getPixivHeaders();
            const crawler = new PixivCrawler(pid, headersList, logManager, taskId);
            const recommendPids = await crawler.getIllustRecommendPids(pid, targetNum);
            
            const response = {
              message: '插画推荐PID获取完成',
              pid,
              targetNum,
              count: recommendPids.length,
              pids: recommendPids,
              taskId,
              timestamp: new Date().toISOString()
            };
            
            console.log(`[${timestamp}] Illust-recommend-pids API响应: 获取到${recommendPids.length}个推荐PID`);
            res.status(200).json(response);
          } catch (error) {
            console.error(`[${timestamp}] Illust-recommend-pids API错误:`, error);
            res.status(500).json({
              error: '获取插画推荐PID失败',
              message: error instanceof Error ? error.message : '未知错误'
            });
          }
        } else if (action === 'author-recommend-pids') {
          // 获取作者推荐PID列表
          const pid = req.query.pid as string;
          const targetNum = parseInt(req.query.targetNum as string) || 30;
          console.log(`[${timestamp}] 处理author-recommend-pids API请求 - pid: ${pid}, targetNum: ${targetNum}`);
          
          if (!pid) {
            console.log(`[${timestamp}] Author-recommend-pids API错误: 缺少PID参数`);
            res.status(400).json({ error: '缺少PID参数' });
            return;
          }
          
          try {
            const taskId = 'author_recommend_' + pid + '_' + Date.now();
            logManager.addLog(`收到作者推荐PID获取请求: ${pid}，目标数量: ${targetNum}`, 'info', taskId);
            
            const headersList = getPixivHeaders();
            const crawler = new PixivCrawler(pid, headersList, logManager, taskId);
            const recommendPids = await crawler.getAuthorRecommendPids(pid, targetNum);
            
            const response = {
              message: '作者推荐PID获取完成',
              pid,
              targetNum,
              count: recommendPids.length,
              pids: recommendPids,
              taskId,
              timestamp: new Date().toISOString()
            };
            
            console.log(`[${timestamp}] Author-recommend-pids API响应: 获取到${recommendPids.length}个推荐PID`);
            res.status(200).json(response);
          } catch (error) {
            console.error(`[${timestamp}] Author-recommend-pids API错误:`, error);
            res.status(500).json({
              error: '获取作者推荐PID失败',
              message: error instanceof Error ? error.message : '未知错误'
            });
          }
        } else if (action === 'pid-detail-info') {
          // 获取PID详细信息并入库
          const pid = req.query.pid as string;
          console.log(`[${timestamp}] 处理pid-detail-info API请求 - pid: ${pid}`);
          
          if (!pid) {
            console.log(`[${timestamp}] Pid-detail-info API错误: 缺少PID参数`);
            res.status(400).json({ error: '缺少PID参数' });
            return;
          }
          
          try {
            const taskId = 'detail_info_' + pid + '_' + Date.now();
            logManager.addLog(`收到PID详细信息获取请求: ${pid}`, 'info', taskId);
            
            const headersList = getPixivHeaders();
            const crawler = new PixivCrawler(pid, headersList, logManager, taskId);
            const success = await crawler.getPidDetailInfo(pid);
            
            const response = {
              message: success ? 'PID详细信息获取并入库完成' : 'PID详细信息获取失败或跳过',
              pid,
              success,
              taskId,
              timestamp: new Date().toISOString()
            };
            
            console.log(`[${timestamp}] Pid-detail-info API响应: ${success ? '成功' : '失败'}`);
            res.status(200).json(response);
          } catch (error) {
            console.error(`[${timestamp}] Pid-detail-info API错误:`, error);
            res.status(500).json({
              error: '获取PID详细信息失败',
              message: error instanceof Error ? error.message : '未知错误'
            });
          }
        } else if (action === 'daily' || action === 'weekly' || action === 'monthly') {
          // 触发按类型排行榜抓取
          const type = action as 'daily' | 'weekly' | 'monthly';
          const taskId = type + '_' + new Date().toISOString().slice(0, 10) + '_' + Date.now();
          console.log(`[${timestamp}] 处理${type} API请求 - taskId: ${taskId}`);
          logManager.addLog(`收到${type}排行榜抓取请求`, 'info', taskId);
          const response = { message: `${type} 排行榜任务已启动`, taskId, timestamp: new Date().toISOString() };
          console.log(`[${timestamp}] ${type} API响应:`, response);
          res.status(200).json(response);
          runRanking(type, taskId).catch(error => {
            logManager.addLog(`${type} 排行榜任务执行失败: ` + (error instanceof Error ? error.message : String(error)), 'error', taskId);
          });
        } else {
          // 返回HTML页面
          try {
            // 尝试多个可能的路径
            let htmlContent = '';
            const possiblePaths = [
              path.join(__dirname, 'templates', 'index.html'),
              path.join(__dirname, '..', 'templates', 'index.html'),
              path.join(process.cwd(), 'src', 'templates', 'index.html'),
              path.join(process.cwd(), 'templates', 'index.html'),
              path.join(process.cwd(), 'dist', 'templates', 'index.html')
            ];
            
            let templateFound = false;
            for (const htmlPath of possiblePaths) {
              try {
                if (fs.existsSync(htmlPath)) {
                  htmlContent = fs.readFileSync(htmlPath, 'utf8');
                  templateFound = true;
                  break;
                }
              } catch (err) {
                continue;
              }
            }
            
            if (!templateFound) {
              // 如果找不到模板文件，返回内联HTML
              htmlContent = getInlineHTML();
            }
            
            res.setHeader('Content-Type', 'text/html');
            res.status(200).send(htmlContent);
          } catch (error) {
            console.error('模板加载错误:', error);
            // 即使出错也返回内联HTML
            res.setHeader('Content-Type', 'text/html');
            res.status(200).send(getInlineHTML());
          }
        }
        break;

      case 'POST':
        // 启动爬虫任务或下载任务
        const { pid, pids, targetNum = 1000, popularityThreshold, action: postAction } = req.body;
        console.log(`[${timestamp}] POST请求 - action: ${postAction || 'crawler'}, body:`, req.body);

        // 处理下载请求
        if (postAction === 'download') {
          const { downloadPid, downloadPids } = req.body;
          console.log(`[${timestamp}] 处理download请求 - downloadPid: ${downloadPid}, downloadPids: ${downloadPids?.length || 0}个`);
          
          if (!downloadPid && !downloadPids) {
            console.log(`[${timestamp}] Download请求错误: 缺少必要参数`);
            res.status(400).json({ error: '下载请求缺少必要的参数: downloadPid 或 downloadPids' });
            return;
          }

          // 检查基础环境变量配置
          const envCheck = checkEnvironmentVariables();
          if (!envCheck.valid) {
            res.status(500).json({ 
              error: '基础环境变量配置不完整', 
              missing: envCheck.missing,
              message: '缺少必需的环境变量: ' + envCheck.missing.join(', ')
            });
            return;
          }

          // 检查R2配置
          const r2Check = checkR2Config();
          if (!r2Check.valid) {
            res.status(500).json({ 
              error: 'R2配置不完整，无法使用下载功能', 
              missing: r2Check.missing,
              message: '缺少R2配置，下载功能不可用。缺少: ' + r2Check.missing.join(', ')
            });
            return;
          }

          try {
            const headersList = getPixivHeaders();
            const r2Config = getR2Config();
            
            if (downloadPid) {
              // 单个PID下载
              const taskId = 'download_single_' + downloadPid + '_' + Date.now();
              console.log(`[${timestamp}] 启动单个PID下载任务 - pid: ${downloadPid}, taskId: ${taskId}`);
              logManager.addLog(`收到单个PID下载请求: ${downloadPid}`, 'info', taskId);
              
              const response = { 
                message: '下载任务已启动', 
                pid: downloadPid,
                taskId,
                timestamp: new Date().toISOString()
              };
              console.log(`[${timestamp}] Download API响应:`, response);
              res.status(200).json(response);
              
              // 异步执行下载任务
              const downloader = new PixivDownloader(headersList[0], r2Config, logManager, taskId);
              downloader.downloadIllust(downloadPid).then(result => {
                if (result.success) {
                  logManager.addLog(`图片 ${downloadPid} 下载完成`, 'success', taskId);
                } else {
                  logManager.addLog(`图片 ${downloadPid} 下载失败: ${result.error}`, 'error', taskId);
                }
              }).catch(error => {
                logManager.addLog('下载任务执行失败: ' + (error instanceof Error ? error.message : String(error)), 'error', taskId);
              });
              
            } else if (downloadPids && Array.isArray(downloadPids)) {
              // 批量PID下载
              const taskId = 'download_batch_' + Date.now();
              console.log(`[${timestamp}] 启动批量PID下载任务 - count: ${downloadPids.length}, taskId: ${taskId}`);
              logManager.addLog(`收到批量PID下载请求，共${downloadPids.length}个PID`, 'info', taskId);
              
              const response = { 
                message: '批量下载任务已启动', 
                pids: downloadPids,
                count: downloadPids.length,
                taskId,
                timestamp: new Date().toISOString()
              };
              console.log(`[${timestamp}] Batch Download API响应:`, response);
              res.status(200).json(response);
              
              // 异步执行批量下载任务
              const downloader = new PixivDownloader(headersList[0], r2Config, logManager, taskId);
              downloader.batchDownload(downloadPids).then(results => {
                const successCount = results.filter(r => r.success).length;
                logManager.addLog(`批量下载完成，成功: ${successCount}/${downloadPids.length}`, 'success', taskId);
              }).catch(error => {
                logManager.addLog('批量下载任务执行失败: ' + (error instanceof Error ? error.message : String(error)), 'error', taskId);
              });
            } else {
              res.status(400).json({ error: 'downloadPids参数必须是数组' });
            }
          } catch (error) {
            res.status(500).json({ 
              error: '下载任务启动失败', 
              message: error instanceof Error ? error.message : String(error)
            });
          }
          return;
        }

        // 处理爬虫任务
        console.log(`[${timestamp}] 处理爬虫任务 - pid: ${pid}, pids: ${pids?.length || 0}个`);
        if (!pid && !pids) {
          console.log(`[${timestamp}] 爬虫请求错误: 缺少必要参数`);
          res.status(400).json({ error: '缺少必要的参数: pid 或 pids' });
          return;
        }

        // 取消热度阈值强校验，允许自由传入；默认值仅用于兼容旧客户端
        let threshold = (popularityThreshold !== undefined) ? parseFloat(popularityThreshold) : 0.0;
        if (Number.isNaN(threshold)) threshold = 0.0;

        // 检查环境变量配置
        if (!checkEnvVariables()) {
          res.status(500).json({ error: '环境变量配置不完整，请检查所有必需的环境变量' });
          return;
        }

        // 检查Pixiv Cookie配置
        if (!process.env.PIXIV_COOKIE || process.env.PIXIV_COOKIE === 'your_pixiv_cookie_here') {
          res.status(500).json({ error: 'Pixiv Cookie 未配置，请在 .env 文件中设置 PIXIV_COOKIE' });
          return;
        }

        if (pid) {
          // 单个PID爬取
          const taskId = 'single_' + pid + '_' + Date.now();
          console.log(`[${timestamp}] 启动单个PID爬虫任务 - pid: ${pid}, targetNum: ${targetNum}, threshold: ${threshold}, taskId: ${taskId}`);
          logManager.addLog(`收到单个PID爬取请求: ${pid}，目标数量: ${targetNum}，热度阈值: ${threshold}`, 'info', taskId);
          
          const response = { 
            message: '爬虫任务已启动', 
            pid, 
            targetNum,
            popularityThreshold: threshold,
            taskId,
            timestamp: new Date().toISOString()
          };
          console.log(`[${timestamp}] Crawler API响应:`, response);
          res.status(200).json(response);
          
          // 异步执行爬虫任务，传递正确的TaskID
          runCrawler(pid, targetNum, threshold, taskId).catch(error => {
            logManager.addLog('爬虫任务执行失败: ' + (error instanceof Error ? error.message : String(error)), 'error', taskId);
            console.error('爬虫任务执行失败:', error);
          });
        } else if (pids && Array.isArray(pids)) {
          // 批量PID爬取
          const taskId = 'batch_' + Date.now();
          console.log(`[${timestamp}] 启动批量PID爬虫任务 - count: ${pids.length}, targetNum: ${targetNum}, threshold: ${threshold}, taskId: ${taskId}`);
          logManager.addLog(`收到批量PID爬取请求，共${pids.length}个PID，目标数量: ${targetNum}，热度阈值: ${threshold}`, 'info', taskId);
          
          const response = { 
            message: '批量爬虫任务已启动', 
            pids, 
            targetNum,
            popularityThreshold: threshold,
            count: pids.length,
            taskId,
            timestamp: new Date().toISOString()
          };
          console.log(`[${timestamp}] Batch Crawler API响应:`, response);
          res.status(200).json(response);
          
          // 异步执行批量爬虫任务，传递正确的TaskID
          batchCrawl(pids, targetNum, threshold, taskId).catch(error => {
            logManager.addLog('批量爬虫任务执行失败: ' + (error instanceof Error ? error.message : String(error)), 'error', taskId);
            console.error('批量爬虫任务执行失败:', error);
          });
        } else {
          res.status(400).json({ error: 'pids参数必须是数组' });
        }
        break;

      default:
        res.setHeader('Allow', ['GET', 'POST']);
        res.status(405).json({ error: 'Method ' + method + ' Not Allowed' });
    }
  } catch (error) {
    console.error('API处理错误:', error);
    res.status(500).json({ 
      error: '内部服务器错误', 
      message: error instanceof Error ? error.message : '未知错误'
    });
  }
}

// 如果直接运行此文件（非serverless环境）
if (require.main === module) {
  console.log('Pixiv爬虫服务启动中...');
  
  // 这里可以添加命令行参数处理
  const args = process.argv.slice(2);
  if (args.length > 0) {
    const pid = args[0];
    const targetNum = args[1] ? parseInt(args[1]) : 1000;
    
    console.log('命令行模式：爬取PID ' + pid + '，目标数量 ' + targetNum);
    runCrawler(pid, targetNum).catch(console.error);
  } else {
    // 启动HTTP服务器
    const http = require('http');
    const port = process.env.PORT || 3000;
    
    const server = http.createServer((req: any, res: any) => {
       // 模拟Vercel请求对象
       const vercelReq = {
         ...req,
         query: {},
         body: {}
       };
       
       // 模拟Vercel响应对象
       const vercelRes = {
         ...res,
         status: (code: number) => {
           res.statusCode = code;
           return vercelRes;
         },
         json: (data: any) => {
           res.setHeader('Content-Type', 'application/json');
           res.end(JSON.stringify(data));
         },
         send: (data: any) => {
           if (typeof data === 'string') {
             res.setHeader('Content-Type', 'text/html');
           }
           res.end(data);
         },
         setHeader: (name: string, value: string) => {
           res.setHeader(name, value);
         },
         end: () => {
           res.end();
         }
       };
       
       // 解析查询参数
       if (req.url) {
         const url = new URL(req.url, 'http://localhost:' + port);
         for (const [key, value] of url.searchParams) {
           vercelReq.query[key] = value;
         }
       }
       
       // 解析POST请求体
       if (req.method === 'POST') {
         let body = '';
         req.on('data', (chunk: any) => {
           body += chunk.toString();
         });
         req.on('end', () => {
           try {
             vercelReq.body = JSON.parse(body);
           } catch (error) {
             vercelReq.body = {};
           }
           handler(vercelReq, vercelRes);
         });
       } else {
         handler(vercelReq, vercelRes);
       }
     });
    
    server.listen(port, () => {
      console.log('🚀 Pixiv爬虫服务已启动');
      console.log('📱 Web界面: http://localhost:' + port);
      console.log('🔧 API端点: http://localhost:' + port + '/api');
      console.log('💡 请在 .env 文件中配置必要的环境变量');
      
      // 添加启动日志
      logManager.addLog('HTTP服务器启动成功，端口: ' + port, 'success');
    });
  }
}

// Cloudflare Workers 适配（可选导出）
export const cfHandler = {
  async fetch(request: Request, env: any): Promise<Response> {
    // 将 CF Request 适配为 Vercel 风格请求
    const url = new URL(request.url);
    const query: Record<string, string> = {};
    url.searchParams.forEach((v, k) => (query[k] = v));

    const bodyText = request.method === 'POST' ? await request.text() : '';
    let body: any = {};
    try { body = bodyText ? JSON.parse(bodyText) : {}; } catch {}

    const vercelReq: any = { method: request.method, query, body };

    const headers: Record<string, string> = {};
    let statusCode = 200;
    let responseBody: any = '';

    const vercelRes: any = {
      setHeader: (k: string, v: string) => { headers[k] = v; },
      status: (code: number) => { statusCode = code; return vercelRes; },
      json: (data: any) => { headers['Content-Type'] = 'application/json'; responseBody = JSON.stringify(data); },
      send: (data: any) => { responseBody = typeof data === 'string' ? data : String(data); }
    };

    await handler(vercelReq, vercelRes);
    return new Response(responseBody, { status: statusCode, headers });
  }
};