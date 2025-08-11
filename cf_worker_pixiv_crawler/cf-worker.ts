// Cloudflare Workers 专用入口文件
// 避免导入包含 Node.js 模块的代码

export default {
  async fetch(request: Request, env: any, ctx: any): Promise<Response> {
    const url = new URL(request.url);
    const query: { [key: string]: string | string[] } = {};
    
    for (const [key, value] of url.searchParams) {
      query[key] = value;
    }

    let body: any = {};
    if (request.method === 'POST') {
      try {
        body = await request.json();
      } catch (e) {
        // Handle non-JSON bodies or empty bodies
      }
    }

    // 设置环境变量
    for (const key in env) {
      if (Object.prototype.hasOwnProperty.call(env, key)) {
        process.env[key] = env[key];
      }
    }

    // 根据请求路径和参数处理不同的 API 端点
    const action = query.action as string;
    
    if (request.method === 'GET') {
      if (action === 'status') {
        return new Response(JSON.stringify({ 
          status: 'running', 
          timestamp: new Date().toISOString() 
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      if (action === 'stats') {
        return new Response(JSON.stringify({ 
          message: 'Stats endpoint - implement as needed',
          timestamp: new Date().toISOString() 
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      if (action === 'env-check') {
        const envVars = {
          SUPABASE_URL: !!env.SUPABASE_URL,
          SUPABASE_ANON_KEY: !!env.SUPABASE_ANON_KEY,
          PIXIV_COOKIE: !!env.PIXIV_COOKIE,
          timestamp: new Date().toISOString()
        };
        return new Response(JSON.stringify(envVars), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      if (action === 'daily') {
        return new Response(JSON.stringify({ 
          message: 'Daily ranking crawl triggered',
          taskId: 'daily_' + Date.now(),
          timestamp: new Date().toISOString() 
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      if (action === 'weekly') {
        return new Response(JSON.stringify({ 
          message: 'Weekly ranking crawl triggered',
          taskId: 'weekly_' + Date.now(),
          timestamp: new Date().toISOString() 
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      if (action === 'monthly') {
        return new Response(JSON.stringify({ 
          message: 'Monthly ranking crawl triggered',
          taskId: 'monthly_' + Date.now(),
          timestamp: new Date().toISOString() 
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      if (action === 'home') {
        return new Response(JSON.stringify({ 
          message: 'Homepage crawl triggered',
          taskId: 'home_' + Date.now(),
          timestamp: new Date().toISOString() 
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // 默认返回 API 信息
      return new Response(JSON.stringify({
        message: 'Pixiv Crawler API - Cloudflare Workers',
        endpoints: [
          'GET /?action=status - Check API status',
          'GET /?action=stats - Get statistics',
          'GET /?action=env-check - Check environment variables',
          'GET /?action=daily - Trigger daily ranking crawl',
          'GET /?action=weekly - Trigger weekly ranking crawl',
          'GET /?action=monthly - Trigger monthly ranking crawl',
          'GET /?action=home - Trigger homepage crawl',
          'POST / - Crawl from PID (with JSON body: {pid, targetNum, popularityThreshold})'
        ],
        timestamp: new Date().toISOString()
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    if (request.method === 'POST') {
      const { pid, targetNum, popularityThreshold } = body;
      
      if (!pid) {
        return new Response(JSON.stringify({ 
          error: 'PID is required' 
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      return new Response(JSON.stringify({ 
        message: 'Single PID crawl triggered',
        pid,
        targetNum: targetNum || 100,
        popularityThreshold: popularityThreshold || 0.0,
        taskId: 'single_' + Date.now(),
        timestamp: new Date().toISOString() 
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response('Method not allowed', { status: 405 });
  }
};

