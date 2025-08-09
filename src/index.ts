import { VercelRequest, VercelResponse } from '@vercel/node';
import { PixivCrawler } from './services/pixiv-crawler';
import { getPixivHeaders } from './config';
import { SupabaseService } from './database/supabase';

// 主爬虫函数
async function runCrawler(pid: string, targetNum: number = 1000): Promise<void> {
  try {
    const headersList = getPixivHeaders();
    const pixivCrawler = new PixivCrawler(pid, headersList);
    
    console.log(`开始爬取Pixiv插画，起始PID: ${pid}`);
    await pixivCrawler.getPidsFromOriginPid(pid, targetNum);
    console.log(`爬取完成，起始PID: ${pid}`);
    
  } catch (error) {
    console.error(`爬取失败，起始PID: ${pid}`, error);
    throw error;
  }
}

// 批量爬取函数
async function batchCrawl(pids: string[], targetNum: number = 1000): Promise<void> {
  console.log(`开始批量爬取，共${pids.length}个PID`);
  
  for (const pid of pids) {
    if (pid.trim() === '') continue;
    
    try {
      await runCrawler(pid.trim(), targetNum);
      console.log(`PID ${pid} 爬取完成`);
    } catch (error) {
      console.error(`PID ${pid} 爬取失败:`, error);
      // 继续处理下一个PID
    }
  }
  
  console.log('批量爬取完成');
}

// API路由处理
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 设置CORS头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const { method } = req;

    switch (method) {
      case 'GET':
        // 获取爬虫状态或数据
        if (req.query.action === 'status') {
          res.status(200).json({ 
            status: 'running', 
            message: 'Pixiv爬虫服务运行中',
            timestamp: new Date().toISOString()
          });
        } else if (req.query.action === 'pics') {
          // 获取图片数据
          const supabase = new SupabaseService();
          const tags = req.query.tags ? (req.query.tags as string).split(',') : [];
          const limit = parseInt(req.query.limit as string) || 10;
          
          const pics = await supabase.getPicsByTags(tags, [], limit);
          res.status(200).json({ pics, count: pics.length });
        } else if (req.query.action === 'stats') {
          // 获取统计信息
          try {
            const supabase = new SupabaseService();
            const totalPics = await supabase.getTotalPicsCount();
            const downloadedPics = await supabase.getDownloadedPicsCount();
            const avgPopularity = await supabase.getAveragePopularity();
            
            res.status(200).json({
              totalPics,
              downloadedPics,
              avgPopularity: avgPopularity.toFixed(2)
            });
          } catch (error) {
            res.status(500).json({ error: '获取统计信息失败' });
          }
        } else {
          // 返回HTML页面
          res.setHeader('Content-Type', 'text/html');
          res.status(200).send(`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Pixiv爬虫控制台</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: rgba(255, 255, 255, 0.95);
            border-radius: 20px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
            overflow: hidden;
        }

        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            text-align: center;
        }

        .header h1 {
            font-size: 2.5rem;
            margin-bottom: 10px;
            font-weight: 300;
        }

        .header p {
            font-size: 1.1rem;
            opacity: 0.9;
        }

        .main-content {
            padding: 40px;
        }

        .control-panel {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 30px;
            margin-bottom: 40px;
        }

        .card {
            background: white;
            border-radius: 15px;
            padding: 30px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
            border: 1px solid #e1e5e9;
        }

        .card h3 {
            color: #333;
            margin-bottom: 20px;
            font-size: 1.3rem;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .card h3::before {
            content: '';
            width: 4px;
            height: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border-radius: 2px;
        }

        .form-group {
            margin-bottom: 20px;
        }

        .form-group label {
            display: block;
            margin-bottom: 8px;
            color: #555;
            font-weight: 500;
        }

        .form-group input, .form-group textarea {
            width: 100%;
            padding: 12px 15px;
            border: 2px solid #e1e5e9;
            border-radius: 8px;
            font-size: 14px;
            transition: all 0.3s ease;
        }

        .form-group input:focus, .form-group textarea:focus {
            outline: none;
            border-color: #667eea;
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }

        .btn {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            padding: 12px 30px;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.3s ease;
            width: 100%;
        }

        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 20px rgba(102, 126, 234, 0.3);
        }

        .btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }

        .btn-secondary {
            background: linear-gradient(135deg, #6c757d 0%, #495057 100%);
        }

        .btn-secondary:hover {
            box-shadow: 0 10px 20px rgba(108, 117, 125, 0.3);
        }

        .status-panel {
            background: #f8f9fa;
            border-radius: 15px;
            padding: 30px;
            margin-bottom: 30px;
        }

        .status-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 20px;
        }

        .status-item {
            background: white;
            padding: 20px;
            border-radius: 10px;
            text-align: center;
            border: 1px solid #e1e5e9;
        }

        .status-item .value {
            font-size: 2rem;
            font-weight: bold;
            color: #667eea;
            margin-bottom: 5px;
        }

        .status-item .label {
            color: #666;
            font-size: 0.9rem;
        }

        .log-panel {
            background: #1e1e1e;
            color: #00ff00;
            border-radius: 15px;
            padding: 20px;
            font-family: 'Courier New', monospace;
            font-size: 14px;
            max-height: 400px;
            overflow-y: auto;
            white-space: pre-wrap;
        }

        .log-entry {
            margin-bottom: 5px;
            padding: 2px 0;
        }

        .log-entry.info { color: #00ff00; }
        .log-entry.error { color: #ff4444; }
        .log-entry.warning { color: #ffaa00; }

        .progress-bar {
            width: 100%;
            height: 8px;
            background: #e1e5e9;
            border-radius: 4px;
            overflow: hidden;
            margin: 20px 0;
        }

        .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
            width: 0%;
            transition: width 0.3s ease;
        }

        .alert {
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
            display: none;
        }

        .alert.success {
            background: #d4edda;
            color: #155724;
            border: 1px solid #c3e6cb;
        }

        .alert.error {
            background: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
        }

        .alert.info {
            background: #d1ecf1;
            color: #0c5460;
            border: 1px solid #bee5eb;
        }

        @media (max-width: 768px) {
            .control-panel {
                grid-template-columns: 1fr;
            }
            
            .header h1 {
                font-size: 2rem;
            }
            
            .main-content {
                padding: 20px;
            }
        }

        .loading {
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 3px solid #f3f3f3;
            border-top: 3px solid #667eea;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin-right: 10px;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🕷️ Pixiv爬虫控制台</h1>
            <p>智能爬取Pixiv插画，支持推荐算法和热度分析</p>
        </div>

        <div class="main-content">
            <!-- 状态面板 -->
            <div class="status-panel">
                <h3>📊 系统状态</h3>
                <div class="status-grid">
                    <div class="status-item">
                        <div class="value" id="status-value">运行中</div>
                        <div class="label">服务状态</div>
                    </div>
                    <div class="status-item">
                        <div class="value" id="total-pics">0</div>
                        <div class="label">总图片数</div>
                    </div>
                    <div class="status-item">
                        <div class="value" id="downloaded-pics">0</div>
                        <div class="label">已下载</div>
                    </div>
                    <div class="status-item">
                        <div class="value" id="avg-popularity">0.00</div>
                        <div class="label">平均热度</div>
                    </div>
                </div>
                <button class="btn btn-secondary" onclick="refreshStatus()">🔄 刷新状态</button>
            </div>

            <!-- 控制面板 -->
            <div class="control-panel">
                <!-- 单个PID爬取 -->
                <div class="card">
                    <h3>🎯 单个PID爬取</h3>
                    <div class="form-group">
                        <label for="single-pid">Pixiv插画ID</label>
                        <input type="text" id="single-pid" placeholder="例如: 12345678" maxlength="10">
                    </div>
                    <div class="form-group">
                        <label for="single-target">目标数量</label>
                        <input type="number" id="single-target" value="100" min="1" max="10000">
                    </div>
                    <button class="btn" onclick="startSingleCrawl()" id="single-btn">
                        🚀 开始爬取
                    </button>
                </div>

                <!-- 批量PID爬取 -->
                <div class="card">
                    <h3>📦 批量PID爬取</h3>
                    <div class="form-group">
                        <label for="batch-pids">Pixiv插画ID列表</label>
                        <textarea id="batch-pids" rows="4" placeholder="每行一个PID，例如:&#10;12345678&#10;87654321&#10;11223344"></textarea>
                    </div>
                    <div class="form-group">
                        <label for="batch-target">目标数量</label>
                        <input type="number" id="batch-target" value="500" min="1" max="10000">
                    </div>
                    <button class="btn" onclick="startBatchCrawl()" id="batch-btn">
                        🚀 批量爬取
                    </button>
                </div>
            </div>

            <!-- 进度条 -->
            <div id="progress-container" style="display: none;">
                <h3>📈 爬取进度</h3>
                <div class="progress-bar">
                    <div class="progress-fill" id="progress-fill"></div>
                </div>
                <div style="text-align: center; color: #666;">
                    <span id="progress-text">准备中...</span>
                </div>
            </div>

            <!-- 日志面板 -->
            <div class="log-panel">
                <h3 style="color: white; margin-bottom: 15px;">📝 运行日志</h3>
                <div id="log-content">
                    <div class="log-entry info">系统启动完成，等待任务...</div>
                </div>
            </div>
        </div>
    </div>

    <!-- 提示框 -->
    <div id="alert-container"></div>

    <script>
        // 配置
        const API_BASE = window.location.origin;
        let isRunning = false;

        // 页面加载完成后初始化
        document.addEventListener('DOMContentLoaded', function() {
            refreshStatus();
            addLog('页面加载完成，系统就绪', 'info');
        });

        // 添加日志
        function addLog(message, type = 'info') {
            const logContent = document.getElementById('log-content');
            const timestamp = new Date().toLocaleTimeString();
            const logEntry = document.createElement('div');
            logEntry.className = \`log-entry \${type}\`;
            logEntry.textContent = \`[\${timestamp}] \${message}\`;
            logContent.appendChild(logEntry);
            logContent.scrollTop = logContent.scrollHeight;
        }

        // 显示提示
        function showAlert(message, type = 'info') {
            const alertContainer = document.getElementById('alert-container');
            const alert = document.createElement('div');
            alert.className = \`alert \${type}\`;
            alert.textContent = message;
            alertContainer.appendChild(alert);
            alert.style.display = 'block';

            setTimeout(() => {
                alert.style.display = 'none';
                alert.remove();
            }, 5000);
        }

        // 刷新状态
        async function refreshStatus() {
            try {
                const response = await fetch(\`\${API_BASE}/?action=status\`);
                const data = await response.json();
                
                if (data.status === 'running') {
                    document.getElementById('status-value').textContent = '运行中';
                    document.getElementById('status-value').style.color = '#28a745';
                }

                // 获取统计信息
                const statsResponse = await fetch(\`\${API_BASE}/?action=stats\`);
                if (statsResponse.ok) {
                    const statsData = await statsResponse.json();
                    document.getElementById('total-pics').textContent = statsData.totalPics || 0;
                    document.getElementById('downloaded-pics').textContent = statsData.downloadedPics || 0;
                    document.getElementById('avg-popularity').textContent = statsData.avgPopularity || '0.00';
                }
                
            } catch (error) {
                addLog(\`状态刷新失败: \${error.message}\`, 'error');
            }
        }

        // 开始单个PID爬取
        async function startSingleCrawl() {
            const pid = document.getElementById('single-pid').value.trim();
            const targetNum = parseInt(document.getElementById('single-target').value);

            if (!pid) {
                showAlert('请输入有效的Pixiv插画ID', 'error');
                return;
            }

            if (isRunning) {
                showAlert('爬虫正在运行中，请等待完成', 'warning');
                return;
            }

            try {
                isRunning = true;
                const btn = document.getElementById('single-btn');
                btn.disabled = true;
                btn.innerHTML = '<span class="loading"></span>爬取中...';

                addLog(\`开始爬取PID: \${pid}，目标数量: \${targetNum}\`, 'info');
                showProgress();

                const response = await fetch(\`\${API_BASE}/\`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        pid: pid,
                        targetNum: targetNum
                    })
                });

                const result = await response.json();
                
                if (response.ok) {
                    showAlert(\`爬虫任务已启动: \${result.message}\`, 'success');
                    addLog(\`任务启动成功: \${result.message}\`, 'info');
                    
                    // 模拟进度更新
                    simulateProgress();
                } else {
                    throw new Error(result.error || '启动失败');
                }

            } catch (error) {
                addLog(\`爬取启动失败: \${error.message}\`, 'error');
                showAlert(\`启动失败: \${error.message}\`, 'error');
            } finally {
                isRunning = false;
                const btn = document.getElementById('single-btn');
                btn.disabled = false;
                btn.innerHTML = '🚀 开始爬取';
                hideProgress();
            }
        }

        // 开始批量PID爬取
        async function startBatchCrawl() {
            const pidsText = document.getElementById('batch-pids').value.trim();
            const targetNum = parseInt(document.getElementById('batch-target').value);

            if (!pidsText) {
                showAlert('请输入有效的Pixiv插画ID列表', 'error');
                return;
            }

            const pids = pidsText.split('\\n').map(pid => pid.trim()).filter(pid => pid);

            if (pids.length === 0) {
                showAlert('没有找到有效的PID', 'error');
                return;
            }

            if (isRunning) {
                showAlert('爬虫正在运行中，请等待完成', 'warning');
                return;
            }

            try {
                isRunning = true;
                const btn = document.getElementById('batch-btn');
                btn.disabled = true;
                btn.innerHTML = '<span class="loading"></span>批量爬取中...';

                addLog(\`开始批量爬取，共\${pids.length}个PID，目标数量: \${targetNum}\`, 'info');
                showProgress();

                const response = await fetch(\`\${API_BASE}/\`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        pids: pids,
                        targetNum: targetNum
                    })
                });

                const result = await response.json();
                
                if (response.ok) {
                    showAlert(\`批量爬虫任务已启动: \${result.message}\`, 'success');
                    addLog(\`批量任务启动成功: \${result.message}\`, 'info');
                    
                    // 模拟进度更新
                    simulateProgress();
                } else {
                    throw new Error(result.error || '启动失败');
                }

            } catch (error) {
                addLog(\`批量爬取启动失败: \${error.message}\`, 'error');
                showAlert(\`启动失败: \${error.message}\`, 'error');
            } finally {
                isRunning = false;
                const btn = document.getElementById('batch-btn');
                btn.disabled = false;
                btn.innerHTML = '🚀 批量爬取';
                hideProgress();
            }
        }

        // 显示进度条
        function showProgress() {
            document.getElementById('progress-container').style.display = 'block';
            document.getElementById('progress-fill').style.width = '0%';
            document.getElementById('progress-text').textContent = '准备中...';
        }

        // 隐藏进度条
        function hideProgress() {
            document.getElementById('progress-container').style.display = 'none';
        }

        // 模拟进度更新
        function simulateProgress() {
            let progress = 0;
            const progressFill = document.getElementById('progress-fill');
            const progressText = document.getElementById('progress-text');
            
            const interval = setInterval(() => {
                progress += Math.random() * 10;
                if (progress >= 100) {
                    progress = 100;
                    clearInterval(interval);
                    setTimeout(() => {
                        hideProgress();
                        addLog('爬取任务完成', 'info');
                    }, 1000);
                }
                
                progressFill.style.width = progress + '%';
                progressText.textContent = \`爬取中... \${Math.round(progress)}%\`;
            }, 500);
        }

        // 定期刷新状态
        setInterval(refreshStatus, 30000); // 每30秒刷新一次
    </script>
</body>
</html>
          `);
        }
        break;

      case 'POST':
        // 启动爬虫任务
        const { pid, pids, targetNum = 1000 } = req.body;

        if (!pid && !pids) {
          res.status(400).json({ error: '缺少必要的参数: pid 或 pids' });
          return;
        }

        if (pid) {
          // 单个PID爬取
          res.status(200).json({ 
            message: '爬虫任务已启动', 
            pid, 
            targetNum,
            timestamp: new Date().toISOString()
          });
          
          // 异步执行爬虫任务
          runCrawler(pid, targetNum).catch(console.error);
        } else if (pids && Array.isArray(pids)) {
          // 批量PID爬取
          res.status(200).json({ 
            message: '批量爬虫任务已启动', 
            pids, 
            targetNum,
            count: pids.length,
            timestamp: new Date().toISOString()
          });
          
          // 异步执行批量爬虫任务
          batchCrawl(pids, targetNum).catch(console.error);
        } else {
          res.status(400).json({ error: 'pids参数必须是数组' });
        }
        break;

      default:
        res.setHeader('Allow', ['GET', 'POST']);
        res.status(405).json({ error: `Method ${method} Not Allowed` });
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
    
    console.log(`命令行模式：爬取PID ${pid}，目标数量 ${targetNum}`);
    runCrawler(pid, targetNum).catch(console.error);
  } else {
    console.log('请提供PID参数，例如: npm run dev 12345678');
    console.log('或者使用API模式: npm start');
  }
} 