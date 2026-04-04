import http from 'http';
import { parseSizeList } from '../proxy/storage-path';

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
 * 从环境变量读取调度器配置
 */
function getSchedulerConfig() {
  // 从环境变量读取，单位为分钟，转换为毫秒
  const minuteToMs = (minutes: number) => minutes * 60 * 1000;
  const parseBool = (value: string | undefined, defaultValue: boolean): boolean => {
    if (value === undefined) return defaultValue;
    const normalized = value.trim().toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(normalized);
  };

  return {
    // 首页推荐间隔（默认10分钟）
    homeInterval: minuteToMs(parseInt(process.env.SCHEDULER_HOME_INTERVAL || '10')),

    // 插画推荐间隔和数量
    illustRecommendInterval: minuteToMs(parseInt(process.env.SCHEDULER_ILLUST_RECOMMEND_INTERVAL || '15')),
    illustRecommendLimit: parseInt(process.env.SCHEDULER_ILLUST_RECOMMEND_LIMIT || '30'),

    // 作者推荐间隔和数量
    authorRecommendInterval: minuteToMs(parseInt(process.env.SCHEDULER_AUTHOR_RECOMMEND_INTERVAL || '15')),
    authorRecommendLimit: parseInt(process.env.SCHEDULER_AUTHOR_RECOMMEND_LIMIT || '30'),

    // 详细信息间隔和数量
    detailInfoInterval: minuteToMs(parseInt(process.env.SCHEDULER_DETAIL_INFO_INTERVAL || '5')),
    detailInfoLimit: parseInt(process.env.SCHEDULER_DETAIL_INFO_LIMIT || '50'),

    // TopN preview download
    autoPreviewInterval: minuteToMs(parseInt(process.env.SCHEDULER_AUTO_PREVIEW_INTERVAL || '60')),
    autoPreviewLimit: parseInt(process.env.SCHEDULER_AUTO_PREVIEW_LIMIT || process.env.AUTO_PREVIEW_DEFAULT_LIMIT || '120'),
    autoPreviewMinPopularity: parseFloat(process.env.SCHEDULER_AUTO_PREVIEW_MIN_POPULARITY || process.env.AUTO_PREVIEW_MIN_POPULARITY || '0'),
    autoPreviewSizes: parseSizeList(
      process.env.SCHEDULER_AUTO_PREVIEW_SIZES ||
        process.env.AUTO_PREVIEW_SIZES ||
        process.env.SCHEDULER_AUTO_PREVIEW_SIZE ||
        process.env.AUTO_PREVIEW_SIZE ||
        'thumb_mini,small',
      ['thumb_mini', 'small']
    ),
    autoPreviewEnabled: parseBool(process.env.SCHEDULER_AUTO_PREVIEW_ENABLED, true)
  };
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
  private tasks: TaskConfig[] = [];

  constructor(port: number, logManager: ILogManager) {
    this.port = port;
    this.logManager = logManager;
    this.initTasks();
  }

  /**
   * 初始化任务配置（从环境变量读取）
   */
  private initTasks(): void {
    const config = getSchedulerConfig();

    this.tasks = [
      // 排行榜任务 - 每天执行一次（固定配置）
      {
        name: '日榜爬取',
        action: 'daily',
        method: 'GET',
        interval: 24 * 60 * 60 * 1000,
        enabled: true
      },
      {
        name: '周榜爬取',
        action: 'weekly',
        method: 'GET',
        interval: 24 * 60 * 60 * 1000,
        enabled: true
      },
      {
        name: '月榜爬取',
        action: 'monthly',
        method: 'GET',
        interval: 24 * 60 * 60 * 1000,
        enabled: true
      },

      // 首页推荐任务（从环境变量读取间隔）
      {
        name: '首页推荐爬取',
        action: 'home',
        method: 'GET',
        interval: config.homeInterval,
        enabled: true
      },

      // 未完成任务处理（从环境变量读取间隔和数量）
      {
        name: '插画推荐任务处理',
        action: 'crawl-uncompleted',
        method: 'POST',
        interval: config.illustRecommendInterval,
        body: {
          action: 'crawl-uncompleted',
          taskType: 'illust_recommend',
          limit: config.illustRecommendLimit
        },
        enabled: true
      },
      {
        name: 'Author recommend processing',
        action: 'crawl-uncompleted',
        method: 'POST',
        interval: config.authorRecommendInterval,
        body: {
          action: 'crawl-uncompleted',
          taskType: 'author_recommend',
          limit: config.authorRecommendLimit
        },
        enabled: true
      },
      {
        name: '详细信息任务处理',
        action: 'crawl-uncompleted',
        method: 'POST',
        interval: config.detailInfoInterval,
        body: {
          action: 'crawl-uncompleted',
          taskType: 'detail_info',
          limit: config.detailInfoLimit
        },
        enabled: true
      },
      {
        name: 'Auto TopN Preview Download',
        action: 'auto-topn-preview',
        method: 'POST',
        interval: config.autoPreviewInterval,
        body: {
          action: 'auto-topn-preview',
          limit: config.autoPreviewLimit,
          minPopularity: config.autoPreviewMinPopularity,
          sizes: config.autoPreviewSizes
        },
        enabled: config.autoPreviewEnabled
      }
    ];

    // 打印配置信息
    this.logManager.addLog(
      `[调度器] 配置已加载: 首页${config.homeInterval/60000}分钟, ` +
      `插画推荐${config.illustRecommendInterval/60000}分钟/${config.illustRecommendLimit}个, ` +
      `作者推荐${config.authorRecommendInterval/60000}分钟/${config.authorRecommendLimit}个, ` +
      `详细信息${config.detailInfoInterval/60000}分钟/${config.detailInfoLimit}个`,
      'info',
      'scheduler'
    );
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

      req.setTimeout(60000, () => {
        req.destroy();
        this.logManager.addLog(
          `[调度器] ${task.name} 请求超时`,
          'warning',
          'scheduler'
        );
        reject(new Error('Request timeout'));
      });

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
      // 错误已在 sendRequest 中记录
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
    this.logManager.addLog('[Scheduler] started', 'success', 'scheduler');

    const startupDelay = 10 * 1000;

    for (const task of this.tasks) {
      if (!task.enabled) {
        this.logManager.addLog(`[调度器] 任务 ${task.name} 已禁用`, 'info', 'scheduler');
        continue;
      }

      const firstRunDelay = startupDelay + Math.random() * 5000;
      setTimeout(() => {
        this.executeTask(task);

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
