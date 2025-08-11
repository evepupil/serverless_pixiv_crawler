export interface Env {
  API_BASE: string;
  TEN_MIN_PIDS?: string; // comma separated
  TEN_MIN_TARGET_NUM?: string;
  TEN_MIN_THRESHOLD?: string;
}

async function callApi(url: string, options?: RequestInit): Promise<Response> {
  const resp = await fetch(url, options);
  return resp;
}

async function triggerTenMin(env: Env): Promise<void> {
  const base = env.API_BASE.replace(/\/$/, '');
  const pidsRaw = (env.TEN_MIN_PIDS || '').trim();
  if (!pidsRaw) {
    // No pids configured, skip
    return;
  }
  const pids = pidsRaw.split(',').map(s => s.trim()).filter(Boolean);
  const targetNum = parseInt(env.TEN_MIN_TARGET_NUM || '100', 10);
  const threshold = parseFloat(env.TEN_MIN_THRESHOLD || '0.22');

  const body = JSON.stringify({ pids, targetNum, popularityThreshold: threshold });
  await callApi(`${base}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  });
}

async function triggerDaily(env: Env): Promise<void> {
  const base = env.API_BASE.replace(/\/$/, '');
  await callApi(`${base}/?action=daily`, { method: 'GET' });
}

async function triggerWeekly(env: Env): Promise<void> {
  const base = env.API_BASE.replace(/\/$/, '');
  await callApi(`${base}/?action=weekly`, { method: 'GET' });
}

async function triggerMonthly(env: Env): Promise<void> {
  const base = env.API_BASE.replace(/\/$/, '');
  await callApi(`${base}/?action=monthly`, { method: 'GET' });
}

function isCron(event: ScheduledEvent): boolean {
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
  async scheduled(event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
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

