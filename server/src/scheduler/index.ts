import http from 'http';

// 日志管理器接口
interface ILogManager {
  addLog(message: string, type: 'info' | 'error' | 'warning' | 'success', taskId?: string): void;
}

// 任务配置接口
interface TaskConfig {
  name: string;           // 任务名称
  action: string;         // API action 参数
  method: 'GET' | 'POST'; // HTTP 方法
  interval: number;       // 执行间隔（毫秒）
  body?: any;             // POST 请求体
  enabled: boolean;       // 是否启用
}

/**
 * 任务调度器
 * 功能：定时触发爬取任务
 */
export class TaskScheduler {
  private port: number;
  private logManager: ILogManager;
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private isRunning: boolean = false;

  // 任务配置列表
  private tasks: TaskConfig[] = [
    // 排行榜任务 - 每天执行一次
    {
      name: '日榜爬取',
      action: 'daily',
      method: 'GET',
      interval: 24 * 60 * 60 * 1000, // 24小时
      enabled: true
    },
    {
      name: '周榜爬取',
      action: 'weekly',
      method: 'GET',
      interval: 24 * 60 * 60 * 1000, // 24小时（每天更新一次周榜数据）
      enabled: true
    },
    {
      name: '月榜爬取',
      action: 'monthly',
      method: 'GET',
      interval: 24 * 60 * 60 * 1000, // 24小时
      enabled: true
    },

    // 首页推荐任务 - 每3分钟执行一次
    {
      name: '首页推荐爬取',
      action: 'home',
      method: 'GET',
      interval: 3 * 60 * 1000, // 3分钟
      enabled: true
    },

    // 未完成任务处理 - 每5分钟执行一次
    {
      name: '插画推荐任务处理',
      action: 'crawl-uncompleted',
      method: 'POST',
      interval: 5 * 60 * 1000, // 5分钟
      body: { action: 'crawl-uncompleted', taskType: 'illust_recommend', limit: 50 },
      enabled: true
    },
    {
      name: '作者推荐任务处理',
      action: 'crawl-uncompleted',
      method: 'POST',
      interval: 5 * 60 * 1000, // 5分钟
      body: { action: 'crawl-uncompleted', taskType: 'author_recommend', limit: 50 },
      enabled: true
    },
    {
      name: '详细信息任务处理',
      action: 'crawl-uncompleted',
      method: 'POST',
      interval: 2 * 60 * 1000, // 2分钟
      body: { action: 'crawl-uncompleted', taskType: 'detail_info', limit: 100 },
      enabled: true
    }
  ];

  constructor(port: number, logManager: ILogManager) {
    this.port = port;
    this.logManager = logManager;
  }

  /**
   * 发送 HTTP 请求到本地服务器
   */
  private async sendRequest(task: TaskConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      const options: http.RequestOptions = {
        hostname: 'localhost',
        port: this.port,
        path: task.method === 'GET' ? `/?action=${task.action}` : '/',
        method: task.method,
        headers: {
          'Content-Type': 'application/json'
        }
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            if (result.success !== false) {
              this.logManager.addLog(
                `[调度器] ${task.name} 执行成功`,
                'success',
                'scheduler'
              );
            } else {
              this.logManager.addLog(
                `[调度器] ${task.name} 执行失败: ${result.error || result.message || '未知错误'}`,
                'warning',
                'scheduler'
              );
            }
          } catch (e) {
            // 非 JSON 响应（如图片代理）也视为成功
            this.logManager.addLog(
              `[调度器] ${task.name} 执行完成`,
              'info',
              'scheduler'
            );
          }
          resolve();
        });
      });

      req.on('error', (error) => {
        this.logManager.addLog(
          `[调度器] ${task.name} 请求失败: ${error.message}`,
          'error',
          'scheduler'
        );
        reject(error);
      });

      // 设置超时
      req.setTimeout(60000, () => {
        req.destroy();
        this.logManager.addLog(
          `[调度器] ${task.name} 请求超时`,
          'warning',
          'scheduler'
        );
        reject(new Error('Request timeout'));
      });

      // 发送请求体（POST 请求）
      if (task.method === 'POST' && task.body) {
        req.write(JSON.stringify(task.body));
      }

      req.end();
    });
  }

  /**
   * 执行单个任务
   */
  private async executeTask(task: TaskConfig): Promise<void> {
    if (!task.enabled) return;

    try {
      this.logManager.addLog(
        `[调度器] 开始执行: ${task.name}`,
        'info',
        'scheduler'
      );
      await this.sendRequest(task);
    } catch (error) {
      // 错误已在 sendRequest 中记录，这里忽略
    }
  }

  /**
   * 启动调度器
   */
  start(): void {
    if (this.isRunning) {
      this.logManager.addLog('[调度器] 调度器已在运行中', 'warning', 'scheduler');
      return;
    }

    this.isRunning = true;
    this.logManager.addLog('[调度器] 调度器启动', 'success', 'scheduler');

    // 启动后延迟 10 秒执行首次任务（等待服务器完全就绪）
    const startupDelay = 10 * 1000;

    // 为每个任务设置定时器
    for (const task of this.tasks) {
      if (!task.enabled) {
        this.logManager.addLog(`[调度器] 任务 ${task.name} 已禁用`, 'info', 'scheduler');
        continue;
      }

      // 设置首次执行（延迟启动）
      const firstRunDelay = startupDelay + Math.random() * 5000; // 加上随机延迟避免同时执行
      setTimeout(() => {
        this.executeTask(task);

        // 设置周期性执行
        const timer = setInterval(() => {
          this.executeTask(task);
        }, task.interval);

        this.timers.set(task.name, timer);
      }, firstRunDelay);

      const intervalMinutes = (task.interval / 1000 / 60).toFixed(1);
      this.logManager.addLog(
        `[调度器] 任务 ${task.name} 已注册，间隔: ${intervalMinutes} 分钟`,
        'info',
        'scheduler'
      );
    }
  }

  /**
   * 停止调度器
   */
  stop(): void {
    if (!this.isRunning) {
      this.logManager.addLog('[调度器] 调度器未运行', 'warning', 'scheduler');
      return;
    }

    // 清除所有定时器
    for (const [name, timer] of this.timers) {
      clearInterval(timer);
      this.logManager.addLog(`[调度器] 停止任务: ${name}`, 'info', 'scheduler');
    }
    this.timers.clear();

    this.isRunning = false;
    this.logManager.addLog('[调度器] 调度器已停止', 'info', 'scheduler');
  }

  /**
   * 手动触发指定任务
   */
  async triggerTask(actionName: string): Promise<void> {
    const task = this.tasks.find(t => t.action === actionName);
    if (!task) {
      this.logManager.addLog(
        `[调度器] 未找到任务: ${actionName}`,
        'error',
        'scheduler'
      );
      return;
    }
    await this.executeTask(task);
  }

  /**
   * 获取任务状态
   */
  getStatus(): { isRunning: boolean; tasks: { name: string; enabled: boolean; interval: number }[] } {
    return {
      isRunning: this.isRunning,
      tasks: this.tasks.map(t => ({
        name: t.name,
        enabled: t.enabled,
        interval: t.interval
      }))
    };
  }

  /**
   * 启用/禁用任务
   */
  setTaskEnabled(actionName: string, enabled: boolean): boolean {
    const task = this.tasks.find(t => t.action === actionName);
    if (!task) return false;
    task.enabled = enabled;
    this.logManager.addLog(
      `[调度器] 任务 ${task.name} ${enabled ? '已启用' : '已禁用'}`,
      'info',
      'scheduler'
    );
    return true;
  }

  /**
   * 更新任务间隔
   */
  setTaskInterval(actionName: string, intervalMs: number): boolean {
    const task = this.tasks.find(t => t.action === actionName);
    if (!task) return false;

    task.interval = intervalMs;
    const intervalMinutes = (intervalMs / 1000 / 60).toFixed(1);
    this.logManager.addLog(
      `[调度器] 任务 ${task.name} 间隔已更新为 ${intervalMinutes} 分钟`,
      'info',
      'scheduler'
    );

    // 如果调度器正在运行，重新设置该任务的定时器
    if (this.isRunning && this.timers.has(task.name)) {
      const oldTimer = this.timers.get(task.name);
      if (oldTimer) clearInterval(oldTimer);

      const timer = setInterval(() => {
        this.executeTask(task);
      }, intervalMs);
      this.timers.set(task.name, timer);
    }

    return true;
  }
}
