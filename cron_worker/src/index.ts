export interface Env {
  PRIMARY_API_BASE: string; // 主节点
  WORKER_API_BASES?: string; // 从节点，逗号分隔
  TEN_MIN_TARGET_NUM?: string;
  TEN_MIN_THRESHOLD?: string;
  SUPABASE_URL?: string; // Supabase项目URL
  SUPABASE_SERVICE_ROLE_KEY?: string; // Supabase服务角色密钥
}

async function callApi(url: string, options?: RequestInit): Promise<Response> {
  const resp = await fetch(url, options);
  return resp;
}

function pickRandom<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.max(0, Math.min(n, copy.length)));
}

/**
 * 触发10分钟定时任务，获取PID并分发给从节点
 * @param env 环境变量配置
 */
async function triggerTenMin(env: Env): Promise<void> {
  const primary = env.PRIMARY_API_BASE.replace(/\/$/, '');
  const workersRaw = (env.WORKER_API_BASES || '').trim();
  const workerBases = workersRaw ? workersRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
  if (workerBases.length === 0) return; // 无从节点则跳过

  let pids: string[] = [];
  
  try {
    // 1) 首先尝试从主节点获取首页推荐 PID 列表
    console.log('尝试获取首页推荐PID列表...');
    const resp = await callApi(`${primary}/?action=home`, { method: 'GET' });
    const json = await resp.json().catch(() => ({ pids: [] }));
    pids = Array.isArray(json?.pids) ? json.pids : [];
    
    if (pids.length > 0) {
      console.log(`成功获取首页推荐PID: ${pids.length}个`);
    } else {
      console.log('首页推荐PID为空，尝试获取随机PID作为备用方案...');
      
      // 2) 如果首页PID为空，则从数据库随机获取PID作为备用方案
      const randomResp = await callApi(`${primary}/?action=random-pids&count=${workerBases.length * 2}`, { method: 'GET' });
      const randomJson = await randomResp.json().catch(() => ({ pids: [] }));
      pids = Array.isArray(randomJson?.pids) ? randomJson.pids : [];
      
      if (pids.length > 0) {
        console.log(`成功获取随机备用PID: ${pids.length}个`);
      } else {
        console.log('无法获取任何PID，跳过本次任务');
        return;
      }
    }
  } catch (error) {
    console.error('获取PID失败:', error);
    
    // 3) 如果获取首页PID失败，尝试获取随机PID作为最后的备用方案
    try {
      console.log('尝试获取随机PID作为最后备用方案...');
      const randomResp = await callApi(`${primary}/?action=random-pids&count=${workerBases.length * 2}`, { method: 'GET' });
      const randomJson = await randomResp.json().catch(() => ({ pids: [] }));
      pids = Array.isArray(randomJson?.pids) ? randomJson.pids : [];
      
      if (pids.length === 0) {
        console.log('所有PID获取方案都失败，跳过本次任务');
        return;
      }
      console.log(`最后备用方案成功获取PID: ${pids.length}个`);
    } catch (fallbackError) {
      console.error('备用PID获取也失败:', fallbackError);
      return;
    }
  }

  // 4) 随机选择 n 个 PID，n = 从节点数量
  const selectedPids = pickRandom(pids, workerBases.length);
  const targetNum = parseInt(env.TEN_MIN_TARGET_NUM || '100', 10);
  const threshold = parseFloat(env.TEN_MIN_THRESHOLD || '0.22');

  console.log(`准备分发${selectedPids.length}个PID给${workerBases.length}个从节点`);

  // 5) 向每个从节点分发单次爬取任务
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] 开始向${workerBases.length}个从节点分发${selectedPids.length}个PID`);
  
  const results = await Promise.allSettled(selectedPids.map(async (pid, idx) => {
    const base = workerBases[idx % workerBases.length].replace(/\/$/, '');
    const body = JSON.stringify({ pid, targetNum, popularityThreshold: threshold });
    const requestTimestamp = new Date().toISOString();
    
    console.log(`[${requestTimestamp}] 分发PID ${pid} 给从节点 ${base} (参数: targetNum=${targetNum}, threshold=${threshold})`);
    
    try {
      const response = await callApi(`${base}`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body 
      });
      
      const responseTimestamp = new Date().toISOString();
      if (response.ok) {
        const responseData = await response.json().catch(() => ({}));
        console.log(`[${responseTimestamp}] ✅ PID ${pid} 分发成功 - 从节点 ${base} 响应:`, responseData);
        return { pid, base, success: true, response: responseData };
      } else {
        console.log(`[${responseTimestamp}] ❌ PID ${pid} 分发失败 - 从节点 ${base} 状态码: ${response.status}`);
        return { pid, base, success: false, error: `HTTP ${response.status}` };
      }
    } catch (error) {
      const errorTimestamp = new Date().toISOString();
      console.error(`[${errorTimestamp}] ❌ PID ${pid} 分发异常 - 从节点 ${base}:`, error);
      return { pid, base, success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }));
  
  // 统计分发结果
  const successCount = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
  const failureCount = results.length - successCount;
  const completionTimestamp = new Date().toISOString();
  
  console.log(`[${completionTimestamp}] 定时任务分发完成 - 成功: ${successCount}/${results.length}, 失败: ${failureCount}`);
  
  // 详细记录失败的分发
  results.forEach((result, idx) => {
    if (result.status === 'rejected') {
      console.error(`[${completionTimestamp}] 分发任务${idx}被拒绝:`, result.reason);
    } else if (!result.value.success) {
      console.error(`[${completionTimestamp}] 分发失败详情 - PID: ${result.value.pid}, 从节点: ${result.value.base}, 错误: ${result.value.error}`);
    }
  });
}

/**
 * 触发每日排行榜抓取任务
 * @param env 环境变量配置
 */
async function triggerDaily(env: Env): Promise<void> {
  const timestamp = new Date().toISOString();
  const base = env.PRIMARY_API_BASE.replace(/\/$/, '');
  console.log(`[${timestamp}] 触发每日排行榜抓取任务 - 目标: ${base}/?action=daily`);
  
  try {
    const response = await callApi(`${base}/?action=daily`, { method: 'GET' });
    const responseTimestamp = new Date().toISOString();
    if (response.ok) {
      const responseData = await response.json().catch(() => ({}));
      console.log(`[${responseTimestamp}] ✅ 每日排行榜任务启动成功:`, responseData);
    } else {
      console.log(`[${responseTimestamp}] ❌ 每日排行榜任务启动失败 - 状态码: ${response.status}`);
    }
  } catch (error) {
    const errorTimestamp = new Date().toISOString();
    console.error(`[${errorTimestamp}] ❌ 每日排行榜任务异常:`, error);
  }
}

/**
 * 触发每周排行榜抓取任务
 * @param env 环境变量配置
 */
async function triggerWeekly(env: Env): Promise<void> {
  const timestamp = new Date().toISOString();
  const base = env.PRIMARY_API_BASE.replace(/\/$/, '');
  console.log(`[${timestamp}] 触发每周排行榜抓取任务 - 目标: ${base}/?action=weekly`);
  
  try {
    const response = await callApi(`${base}/?action=weekly`, { method: 'GET' });
    const responseTimestamp = new Date().toISOString();
    if (response.ok) {
      const responseData = await response.json().catch(() => ({}));
      console.log(`[${responseTimestamp}] ✅ 每周排行榜任务启动成功:`, responseData);
    } else {
      console.log(`[${responseTimestamp}] ❌ 每周排行榜任务启动失败 - 状态码: ${response.status}`);
    }
  } catch (error) {
    const errorTimestamp = new Date().toISOString();
    console.error(`[${errorTimestamp}] ❌ 每周排行榜任务异常:`, error);
  }
}

/**
 * 触发每月排行榜抓取任务
 * @param env 环境变量配置
 */
async function triggerMonthly(env: Env): Promise<void> {
  const timestamp = new Date().toISOString();
  const base = env.PRIMARY_API_BASE.replace(/\/$/, '');
  console.log(`[${timestamp}] 触发每月排行榜抓取任务 - 目标: ${base}/?action=monthly`);
  
  try {
    const response = await callApi(`${base}/?action=monthly`, { method: 'GET' });
    const responseTimestamp = new Date().toISOString();
    if (response.ok) {
      const responseData = await response.json().catch(() => ({}));
      console.log(`[${responseTimestamp}] ✅ 每月排行榜任务启动成功:`, responseData);
    } else {
      console.log(`[${responseTimestamp}] ❌ 每月排行榜任务启动失败 - 状态码: ${response.status}`);
    }
  } catch (error) {
    const errorTimestamp = new Date().toISOString();
    console.error(`[${errorTimestamp}] ❌ 每月排行榜任务异常:`, error);
  }
}

/**
 * 触发插画推荐爬取任务 - 每10分钟获取未爬取插画推荐的任务
 * @param env 环境变量配置
 */
async function triggerIllustRecommendTasks(env: Env): Promise<void> {
  const workersRaw = (env.WORKER_API_BASES || '').trim();
  const workerBases = workersRaw ? workersRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
  if (workerBases.length === 0) {
    console.log('无从节点配置，跳过插画推荐任务');
    return;
  }

  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] 开始获取未爬取插画推荐任务 - 节点数量: ${workerBases.length}`);

  try {
    // 初始化Supabase客户端
    const { createClient } = await import('@supabase/supabase-js');
    const supabaseUrl = env.SUPABASE_URL;
    const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      console.error('❌ 缺少Supabase环境变量');
      return;
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // 直接查询pic_task表获取未爬取插画推荐的任务
    const { data: tasks, error } = await supabase
      .from('pic_task')
      .select('pid')
      .eq('illust_recommend_crawled', false)
      .limit(workerBases.length);
    
    if (error) {
      console.error(`❌ 查询插画推荐任务失败:`, error);
      return;
    }
    
    if (!tasks || tasks.length === 0) {
      console.log('暂无未爬取的插画推荐任务');
      return;
    }

    console.log(`获取到 ${tasks.length} 个插画推荐任务，开始分发给从节点`);

    // 分发任务给从节点
    const results = await Promise.allSettled(tasks.map(async (task: any, idx: number) => {
      const base = workerBases[idx % workerBases.length].replace(/\/$/, '');
      const requestTimestamp = new Date().toISOString();
      
      console.log(`[${requestTimestamp}] 分发插画推荐任务 PID ${task.pid} 给从节点 ${base}`);
      
      try {
        const taskResponse = await callApi(`${base}/?action=illust-recommend-pids&pid=${task.pid}`, { method: 'GET' });
        
        const responseTimestamp = new Date().toISOString();
        if (taskResponse.ok) {
          const taskResponseData = await taskResponse.json().catch(() => ({}));
          console.log(`[${responseTimestamp}] ✅ 插画推荐任务 PID ${task.pid} 分发成功`);
          return { pid: task.pid, base, success: true, response: taskResponseData };
        } else {
          console.log(`[${responseTimestamp}] ❌ 插画推荐任务 PID ${task.pid} 分发失败 - 状态码: ${taskResponse.status}`);
          return { pid: task.pid, base, success: false, error: `HTTP ${taskResponse.status}` };
        }
      } catch (error) {
        const errorTimestamp = new Date().toISOString();
        console.error(`[${errorTimestamp}] ❌ 插画推荐任务 PID ${task.pid} 分发异常:`, error);
        return { pid: task.pid, base, success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }));

    // 统计分发结果
    const successCount = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    const failureCount = results.length - successCount;
    const completionTimestamp = new Date().toISOString();
    
    console.log(`[${completionTimestamp}] 插画推荐任务分发完成 - 成功: ${successCount}/${results.length}, 失败: ${failureCount}`);
    
  } catch (error) {
    const errorTimestamp = new Date().toISOString();
    console.error(`[${errorTimestamp}] ❌ 插画推荐任务处理异常:`, error);
  }
}

/**
 * 触发作者推荐爬取任务 - 每10分钟获取未爬取作者推荐的任务
 * @param env 环境变量配置
 */
async function triggerAuthorRecommendTasks(env: Env): Promise<void> {
  const workersRaw = (env.WORKER_API_BASES || '').trim();
  const workerBases = workersRaw ? workersRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
  if (workerBases.length === 0) {
    console.log('无从节点配置，跳过作者推荐任务');
    return;
  }

  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] 开始获取未爬取作者推荐任务 - 节点数量: ${workerBases.length}`);

  try {
    // 初始化Supabase客户端
    const { createClient } = await import('@supabase/supabase-js');
    const supabaseUrl = env.SUPABASE_URL;
    const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      console.error('❌ 缺少Supabase环境变量');
      return;
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // 直接查询pic_task表获取未爬取作者推荐的任务
    const { data: tasks, error } = await supabase
      .from('pic_task')
      .select('pid')
      .eq('author_recommend_crawled', false)
      .limit(workerBases.length);
    
    if (error) {
      console.error(`❌ 查询作者推荐任务失败:`, error);
      return;
    }
    
    if (!tasks || tasks.length === 0) {
      console.log('暂无未爬取的作者推荐任务');
      return;
    }

    console.log(`获取到 ${tasks.length} 个作者推荐任务，开始分发给从节点`);

    // 分发任务给从节点
    const results = await Promise.allSettled(tasks.map(async (task: any, idx: number) => {
      const base = workerBases[idx % workerBases.length].replace(/\/$/, '');
      const requestTimestamp = new Date().toISOString();
      
      console.log(`[${requestTimestamp}] 分发作者推荐任务 PID ${task.pid} 给从节点 ${base}`);
      
      try {
        const taskResponse = await callApi(`${base}/?action=author-recommend-pids&pid=${task.pid}`, { method: 'GET' });
        
        const responseTimestamp = new Date().toISOString();
        if (taskResponse.ok) {
          const taskResponseData = await taskResponse.json().catch(() => ({}));
          console.log(`[${responseTimestamp}] ✅ 作者推荐任务 PID ${task.pid} 分发成功`);
          return { pid: task.pid, base, success: true, response: taskResponseData };
        } else {
          console.log(`[${responseTimestamp}] ❌ 作者推荐任务 PID ${task.pid} 分发失败 - 状态码: ${taskResponse.status}`);
          return { pid: task.pid, base, success: false, error: `HTTP ${taskResponse.status}` };
        }
      } catch (error) {
        const errorTimestamp = new Date().toISOString();
        console.error(`[${errorTimestamp}] ❌ 作者推荐任务 PID ${task.pid} 分发异常:`, error);
        return { pid: task.pid, base, success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }));

    // 统计分发结果
    const successCount = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    const failureCount = results.length - successCount;
    const completionTimestamp = new Date().toISOString();
    
    console.log(`[${completionTimestamp}] 作者推荐任务分发完成 - 成功: ${successCount}/${results.length}, 失败: ${failureCount}`);
    
  } catch (error) {
    const errorTimestamp = new Date().toISOString();
    console.error(`[${errorTimestamp}] ❌ 作者推荐任务处理异常:`, error);
  }
}

/**
 * 触发详细信息爬取任务 - 每1分钟获取未爬取详细信息的任务
 * @param env 环境变量配置
 */
async function triggerDetailInfoTasks(env: Env): Promise<void> {
  const workersRaw = (env.WORKER_API_BASES || '').trim();
  const workerBases = workersRaw ? workersRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
  if (workerBases.length === 0) {
    console.log('无从节点配置，跳过详细信息任务');
    return;
  }

  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] 开始获取未爬取详细信息任务 - 节点数量: ${workerBases.length}`);

  try {
    // 初始化Supabase客户端
    const { createClient } = await import('@supabase/supabase-js');
    const supabaseUrl = env.SUPABASE_URL;
    const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      console.error('❌ 缺少Supabase环境变量');
      return;
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // 直接查询pic_task表获取未爬取详细信息的任务
    const { data: tasks, error } = await supabase
      .from('pic_task')
      .select('pid')
      .eq('detail_info_crawled', false)
      .limit(workerBases.length);
    
    if (error) {
      console.error(`❌ 查询详细信息任务失败:`, error);
      return;
    }
    
    if (!tasks || tasks.length === 0) {
      console.log('暂无未爬取的详细信息任务');
      return;
    }

    console.log(`获取到 ${tasks.length} 个详细信息任务，开始分发给从节点`);

    // 分发任务给从节点
    const results = await Promise.allSettled(tasks.map(async (task: any, idx: number) => {
      const base = workerBases[idx % workerBases.length].replace(/\/$/, '');
      const requestTimestamp = new Date().toISOString();
      
      console.log(`[${requestTimestamp}] 分发详细信息任务 PID ${task.pid} 给从节点 ${base}`);
      
      try {
        const taskResponse = await callApi(`${base}/?action=pid-detail-info&pid=${task.pid}`, { method: 'GET' });
        
        const responseTimestamp = new Date().toISOString();
        if (taskResponse.ok) {
          const taskResponseData = await taskResponse.json().catch(() => ({}));
          console.log(`[${responseTimestamp}] ✅ 详细信息任务 PID ${task.pid} 分发成功`);
          return { pid: task.pid, base, success: true, response: taskResponseData };
        } else {
          console.log(`[${responseTimestamp}] ❌ 详细信息任务 PID ${task.pid} 分发失败 - 状态码: ${taskResponse.status}`);
          return { pid: task.pid, base, success: false, error: `HTTP ${taskResponse.status}` };
        }
      } catch (error) {
        const errorTimestamp = new Date().toISOString();
        console.error(`[${errorTimestamp}] ❌ 详细信息任务 PID ${task.pid} 分发异常:`, error);
        return { pid: task.pid, base, success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }));

    // 统计分发结果
    const successCount = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    const failureCount = results.length - successCount;
    const completionTimestamp = new Date().toISOString();
    
    console.log(`[${completionTimestamp}] 详细信息任务分发完成 - 成功: ${successCount}/${results.length}, 失败: ${failureCount}`);
    
  } catch (error) {
    const errorTimestamp = new Date().toISOString();
    console.error(`[${errorTimestamp}] ❌ 详细信息任务处理异常:`, error);
  }
}

function isCron(event: any): boolean {
  // In Workers, scheduled events are different type; here we check by presence of cron
  // @ts-ignore
  return !!event?.cron;
}

export default {
  // HTTP endpoint (optional): useful for health-check
  async fetch(_req: Request, _env: Env): Promise<Response> {
    return new Response('pixiv-cron-worker running', { status: 200 });
  },

  // Scheduler entry
  async scheduled(event: any, env: Env, _ctx: any): Promise<void> {
    if (!isCron(event)) return;
    const cronExpr = (event as any).cron as string;
    try {
      switch (cronExpr) {
        case '*/10 * * * *': // 每10分钟 - 原有任务
          //await triggerTenMin(env);
          await triggerIllustRecommendTasks(env);
          await triggerAuthorRecommendTasks(env);
          break;
        case '* * * * *': // 每1分钟 - 详细信息任务
          await triggerDetailInfoTasks(env);
          break;
        case '0 1 * * *':
          await triggerDaily(env);
          break;
        case '0 1 * * 1':
          await triggerWeekly(env);
          break;
        case '0 1 1 * *':
          await triggerMonthly(env);
          break;
        default:
          // Fallback: do nothing
          break;
      }
    } catch (err) {
      // Workers scheduled handlers should not throw to avoid retries storms
      console.error('Scheduled task error:', err);
    }
  }
};

