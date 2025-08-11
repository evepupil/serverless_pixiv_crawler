export interface Env {
  PRIMARY_API_BASE: string; // 主节点
  WORKER_API_BASES?: string; // 从节点，逗号分隔
  TEN_MIN_TARGET_NUM?: string;
  TEN_MIN_THRESHOLD?: string;
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

async function triggerTenMin(env: Env): Promise<void> {
  const primary = env.PRIMARY_API_BASE.replace(/\/$/, '');
  const workersRaw = (env.WORKER_API_BASES || '').trim();
  const workerBases = workersRaw ? workersRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
  if (workerBases.length === 0) return; // 无从节点则跳过

  // 1) 从主节点获取首页推荐 PID 列表
  const resp = await callApi(`${primary}/?action=home`, { method: 'GET' });
  const json = await resp.json().catch(() => ({ pids: [] }));
  const pids: string[] = Array.isArray(json?.pids) ? json.pids : [];
  if (pids.length === 0) return;

  // 2) 随机选择 n 个 PID，n = 从节点数量
  const selectedPids = pickRandom(pids, workerBases.length);
  const targetNum = parseInt(env.TEN_MIN_TARGET_NUM || '100', 10);
  const threshold = parseFloat(env.TEN_MIN_THRESHOLD || '0.22');

  // 3) 向每个从节点分发单次爬取任务
  await Promise.all(selectedPids.map((pid, idx) => {
    const base = workerBases[idx % workerBases.length].replace(/\/$/, '');
    const body = JSON.stringify({ pid, targetNum, popularityThreshold: threshold });
    return callApi(`${base}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  }));
}

async function triggerDaily(env: Env): Promise<void> {
  const base = env.PRIMARY_API_BASE.replace(/\/$/, '');
  await callApi(`${base}/?action=daily`, { method: 'GET' });
}

async function triggerWeekly(env: Env): Promise<void> {
  const base = env.PRIMARY_API_BASE.replace(/\/$/, '');
  await callApi(`${base}/?action=weekly`, { method: 'GET' });
}

async function triggerMonthly(env: Env): Promise<void> {
  const base = env.PRIMARY_API_BASE.replace(/\/$/, '');
  await callApi(`${base}/?action=monthly`, { method: 'GET' });
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
        case '*/10 * * * *':
          await triggerTenMin(env);
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

