import { VercelRequest, VercelResponse } from '@vercel/node';
import { PixivCrawler } from './services/pixiv-crawler';
import { getPixivHeaders } from './config';
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
function checkEnvironmentVariables(): boolean {
  const requiredVars = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    console.warn('Missing environment variables: ' + missingVars.join(', '));
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const { method } = req;
    
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
        
        if (action === 'status') {
          // 返回服务状态
          try {
            const statusData = { 
              status: 'running', 
              timestamp: new Date().toISOString(),
              environment: 'vercel',
              nodeVersion: process.version,
              platform: process.platform,
              envVarsCheck: {
                supabaseUrl: !!process.env.SUPABASE_URL,
                supabaseKey: !!process.env.SUPABASE_ANON_KEY,
                pixivCookie: !!process.env.PIXIV_COOKIE
              }
            };
            console.log('Status API called, returning:', statusData);
            res.status(200).json(statusData);
          } catch (error) {
            console.error('Status API error:', error);
            res.status(500).json({ error: 'Status check failed', details: error instanceof Error ? error.message : String(error) });
          }
        } else if (action === 'stats') {
          // 返回统计信息
          try {
            console.log('Stats API called');
            const stats = await safeDatabaseOperation(async () => {
              const supabase = new SupabaseService();
              const totalPics = await supabase.getTotalPicsCount();
              const downloadedPics = await supabase.getDownloadedPicsCount();
              const avgPopularity = await supabase.getAveragePopularity();
              return { totalPics, downloadedPics, avgPopularity };
            }, { totalPics: 0, downloadedPics: 0, avgPopularity: 0 });
            
            console.log('Stats API returning:', stats);
            res.status(200).json(stats);
          } catch (error) {
            console.error('Stats API error:', error);
            res.status(200).json({ totalPics: 0, downloadedPics: 0, avgPopularity: 0, error: 'Database unavailable' });
          }
        } else if (action === 'env-check') {
          // 检查环境变量
          const valid = checkEnvironmentVariables();
          res.status(200).json({ valid, timestamp: new Date().toISOString() });
        } else if (action === 'logs') {
          // 获取日志
          const taskId = req.query.taskId as string;
          const limit = parseInt(req.query.limit as string) || 100;
          const logs = logManager.getLogs(taskId, limit);
          res.status(200).json(logs);
        } else if (action === 'home') {
          // 获取首页推荐 PID 并最小化入库
          const headersList = getPixivHeaders();
          const taskId = 'home_' + Date.now();
          const crawler = new PixivCrawler('0', headersList, logManager, taskId, 0);
          const pids = await crawler.getHomeRecommendedPids();
          if (pids && pids.length > 0) {
            const supabase = new SupabaseService();
            await supabase.upsertMinimalPics(pids);
            res.status(200).json({ message: '首页推荐已入库', count: pids.length, taskId });
          } else {
            res.status(200).json({ message: '未提取到PID', count: 0, taskId });
          }
        } else if (action === 'daily' || action === 'weekly' || action === 'monthly') {
          // 触发按类型排行榜抓取
          const type = action as 'daily' | 'weekly' | 'monthly';
          const taskId = type + '_' + new Date().toISOString().slice(0, 10) + '_' + Date.now();
          logManager.addLog(`收到${type}排行榜抓取请求`, 'info', taskId);
          res.status(200).json({ message: `${type} 排行榜任务已启动`, taskId, timestamp: new Date().toISOString() });
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
        // 启动爬虫任务
        const { pid, pids, targetNum = 1000, popularityThreshold } = req.body;

        if (!pid && !pids) {
          res.status(400).json({ error: '缺少必要的参数: pid 或 pids' });
          return;
        }

        // 验证热度阈值参数
        let threshold = 0.22; // 默认值
        if (popularityThreshold !== undefined) {
          const parsedThreshold = parseFloat(popularityThreshold);
          if (isNaN(parsedThreshold) || parsedThreshold < 0.01 || parsedThreshold > 1.0) {
            res.status(400).json({ error: '热度阈值必须在 0.01 - 1.0 之间' });
            return;
          }
          threshold = parsedThreshold;
        }

        // 检查环境变量配置
        if (!checkEnvironmentVariables()) {
          res.status(500).json({ error: '环境变量配置不完整，请检查 SUPABASE_URL 和 SUPABASE_ANON_KEY' });
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
          logManager.addLog(`收到单个PID爬取请求: ${pid}，目标数量: ${targetNum}，热度阈值: ${threshold}`, 'info', taskId);
          
          res.status(200).json({ 
            message: '爬虫任务已启动', 
            pid, 
            targetNum,
            popularityThreshold: threshold,
            taskId,
            timestamp: new Date().toISOString()
          });
          
          // 异步执行爬虫任务，传递正确的TaskID
          runCrawler(pid, targetNum, threshold, taskId).catch(error => {
            logManager.addLog('爬虫任务执行失败: ' + (error instanceof Error ? error.message : String(error)), 'error', taskId);
            console.error('爬虫任务执行失败:', error);
          });
        } else if (pids && Array.isArray(pids)) {
          // 批量PID爬取
          const taskId = 'batch_' + Date.now();
          logManager.addLog(`收到批量PID爬取请求，共${pids.length}个PID，目标数量: ${targetNum}，热度阈值: ${threshold}`, 'info', taskId);
          
          res.status(200).json({ 
            message: '批量爬虫任务已启动', 
            pids, 
            targetNum,
            popularityThreshold: threshold,
            count: pids.length,
            taskId,
            timestamp: new Date().toISOString()
          });
          
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