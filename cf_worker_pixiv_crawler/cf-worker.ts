// Cloudflare Workers 主入口文件
// 使用分离的服务模块，复用 Vercel 版本的架构

import { PixivCrawler } from './src/services/pixiv-crawler';
import { SupabaseService } from './src/database/supabase';
import { getPixivHeaders } from './src/config';

// 主 Worker 入口
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

    const action = query.action as string;
    
    if (request.method === 'GET') {
      if (action === 'status') {
        try {
          const supabase = new SupabaseService(env);
          const totalPics = await supabase.getTotalPicsCount();
          const downloadedPics = await supabase.getDownloadedPicsCount();
          
          return new Response(JSON.stringify({ 
            status: 'running', 
            timestamp: new Date().toISOString(),
            environment: 'cloudflare-workers',
            features: ['daily-rank', 'weekly-rank', 'monthly-rank', 'home-recommend', 'pid-crawl', 'database-write'],
            stats: {
              totalPics,
              downloadedPics
            }
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        } catch (error) {
          return new Response(JSON.stringify({ 
            status: 'running', 
            timestamp: new Date().toISOString(),
            environment: 'cloudflare-workers',
            features: ['daily-rank', 'weekly-rank', 'monthly-rank', 'home-recommend', 'pid-crawl', 'database-write'],
            stats: { error: 'Failed to get stats' }
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
      
      if (action === 'env-check') {
        const envVars = {
          SUPABASE_URL: !!env.SUPABASE_URL,
          SUPABASE_PUBLISHABLE_KEY: !!env.SUPABASE_PUBLISHABLE_KEY,
          SUPABASE_SECRET_KEY: !!env.SUPABASE_SECRET_KEY,
          PIXIV_COOKIE: !!env.PIXIV_COOKIE,
          PIXIV_REFERER: !!env.PIXIV_REFERER,
          PIXIV_USER_AGENT: !!env.PIXIV_USER_AGENT,
          timestamp: new Date().toISOString()
        };
        return new Response(JSON.stringify(envVars), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      if (action === 'test') {
        try {
          console.log('=== Testing basic functionality ===');
          console.log('Environment variables check:', {
            hasSupabaseUrl: !!env.SUPABASE_URL,
            hasSupabaseKey: !!env.SUPABASE_SECRET_KEY || !!env.SUPABASE_PUBLISHABLE_KEY,
            hasPixivCookie: !!env.PIXIV_COOKIE,
            cookieLength: env.PIXIV_COOKIE?.length || 0
          });
          
          // 测试 PixivCrawler 初始化
          const headersList = getPixivHeaders();
          const pixivCrawler = new PixivCrawler('0', headersList, null, 'test_' + Date.now(), 0.0, env);
          
          // 测试 SupabaseService 初始化
          const supabase = new SupabaseService(env);
          
          return new Response(JSON.stringify({ 
            message: 'Basic functionality test passed',
            crawlerInitialized: true,
            supabaseInitialized: true,
            taskId: 'test_' + Date.now(),
            timestamp: new Date().toISOString(),
            test: 'success'
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        } catch (error) {
          console.error('Test failed:', error);
          return new Response(JSON.stringify({ 
            error: 'Test failed',
            message: error instanceof Error ? error.message : String(error),
            taskId: 'test_' + Date.now(),
            timestamp: new Date().toISOString(),
            test: 'failed'
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
      
      if (action === 'daily') {
        try {
          console.log('=== Starting daily rank crawl ===');
          const headersList = getPixivHeaders();
          const pixivCrawler = new PixivCrawler('0', headersList, null, 'daily_' + Date.now(), 0.0, env);
          const supabase = new SupabaseService(env);
          
          const result = await pixivCrawler.getDailyRank();
          console.log('Daily rank result:', result);
          
          if (result && result.error === false && result.body.rankings.length > 0) {
            const rankings = result.body.rankings;
            const rankDate = new Date().toISOString().slice(0, 10);
            await supabase.upsertRankings(rankings, rankDate, 'daily');
            await supabase.upsertMinimalPics(rankings.map(r => r.pid));
            
            return new Response(JSON.stringify({ 
              message: 'Daily ranking crawl completed and saved to database',
              result,
              taskId: 'daily_' + Date.now(),
              timestamp: new Date().toISOString(),
              databaseWrite: 'success',
              rankingsCount: rankings.length
            }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          } else {
            return new Response(JSON.stringify({ 
              message: 'Daily ranking crawl failed - no data extracted',
              result,
              taskId: 'daily_' + Date.now(),
              timestamp: new Date().toISOString(),
              databaseWrite: 'skipped',
              error: 'No rankings data to save'
            }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          }
        } catch (error) {
          console.error('Daily crawl failed:', error);
          return new Response(JSON.stringify({ 
            error: 'Daily crawl failed',
            message: error instanceof Error ? error.message : String(error),
            taskId: 'daily_' + Date.now(),
            timestamp: new Date().toISOString(),
            databaseWrite: 'failed'
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
      
      if (action === 'weekly') {
        try {
          console.log('=== Starting weekly rank crawl ===');
          const headersList = getPixivHeaders();
          const pixivCrawler = new PixivCrawler('0', headersList, null, 'weekly_' + Date.now(), 0.0, env);
          const supabase = new SupabaseService(env);
          
          const result = await pixivCrawler.getWeeklyRank();
          console.log('Weekly rank result:', result);
          
          if (result && result.error === false && result.body.rankings.length > 0) {
            const rankings = result.body.rankings;
            const rankDate = new Date().toISOString().slice(0, 10);
            await supabase.upsertRankings(rankings, rankDate, 'weekly');
            await supabase.upsertMinimalPics(rankings.map(r => r.pid));
            
            return new Response(JSON.stringify({ 
              message: 'Weekly ranking crawl completed and saved to database',
              result,
              taskId: 'weekly_' + Date.now(),
              timestamp: new Date().toISOString(),
              databaseWrite: 'success',
              rankingsCount: rankings.length
            }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          } else {
            return new Response(JSON.stringify({ 
              message: 'Weekly ranking crawl failed - no data extracted',
              result,
              taskId: 'weekly_' + Date.now(),
              timestamp: new Date().toISOString(),
              databaseWrite: 'skipped',
              error: 'No rankings data to save'
            }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          }
        } catch (error) {
          console.error('Weekly crawl failed:', error);
          return new Response(JSON.stringify({ 
            error: 'Weekly crawl failed',
            message: error instanceof Error ? error.message : String(error),
            taskId: 'weekly_' + Date.now(),
            timestamp: new Date().toISOString(),
            databaseWrite: 'failed'
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
      
      if (action === 'monthly') {
        try {
          console.log('=== Starting monthly rank crawl ===');
          const headersList = getPixivHeaders();
          const pixivCrawler = new PixivCrawler('0', headersList, null, 'monthly_' + Date.now(), 0.0, env);
          const supabase = new SupabaseService(env);
          
          const result = await pixivCrawler.getMonthlyRank();
          console.log('Monthly rank result:', result);
          
          if (result && result.error === false && result.body.rankings.length > 0) {
            const rankings = result.body.rankings;
            const rankDate = new Date().toISOString().slice(0, 10);
            await supabase.upsertRankings(rankings, rankDate, 'monthly');
            await supabase.upsertMinimalPics(rankings.map(r => r.pid));
            
            return new Response(JSON.stringify({ 
              message: 'Monthly ranking crawl completed and saved to database',
              result,
              taskId: 'monthly_' + Date.now(),
              timestamp: new Date().toISOString(),
              databaseWrite: 'success',
              rankingsCount: rankings.length
            }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          } else {
            return new Response(JSON.stringify({ 
              message: 'Monthly ranking crawl failed - no data extracted',
              result,
              taskId: 'monthly_' + Date.now(),
              timestamp: new Date().toISOString(),
              databaseWrite: 'skipped',
              error: 'No rankings data to save'
            }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          }
        } catch (error) {
          console.error('Monthly crawl failed:', error);
          return new Response(JSON.stringify({ 
            error: 'Monthly crawl failed',
            message: error instanceof Error ? error.message : String(error),
            taskId: 'monthly_' + Date.now(),
            timestamp: new Date().toISOString(),
            databaseWrite: 'failed'
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
      
      if (action === 'home') {
        try {
          console.log('=== Starting homepage crawl ===');
          const headersList = getPixivHeaders();
          const pixivCrawler = new PixivCrawler('0', headersList, null, 'home_' + Date.now(), 0.0, env);
          const supabase = new SupabaseService(env);
          
          const pids = await pixivCrawler.getHomeRecommendedPids();
          console.log('Homepage PIDs extracted:', pids.length);
          
          if (pids.length > 0) {
            await supabase.upsertMinimalPics(pids);
            
            return new Response(JSON.stringify({ 
              message: 'Homepage crawl completed and saved to database',
              pids,
              count: pids.length,
              taskId: 'home_' + Date.now(),
              timestamp: new Date().toISOString(),
              databaseWrite: 'success'
            }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          } else {
            return new Response(JSON.stringify({ 
              message: 'Homepage crawl failed - no PIDs extracted',
              pids: [],
              count: 0,
              taskId: 'home_' + Date.now(),
              timestamp: new Date().toISOString(),
              databaseWrite: 'skipped',
              error: 'No PIDs data to save'
            }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          }
        } catch (error) {
          console.error('Homepage crawl failed:', error);
          return new Response(JSON.stringify({ 
            error: 'Homepage crawl failed',
            message: error instanceof Error ? error.message : String(error),
            taskId: 'home_' + Date.now(),
            timestamp: new Date().toISOString(),
            databaseWrite: 'failed'
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
      
      // 默认返回 API 信息
      return new Response(JSON.stringify({
        message: 'Pixiv Crawler API - Cloudflare Workers (Modular Version)',
        note: 'This CF Worker uses the same architecture as Vercel version!',
        endpoints: [
          'GET /?action=status - Check API status with stats',
          'GET /?action=env-check - Check environment variables',
          'GET /?action=test - Test basic functionality',
          'GET /?action=daily - Crawl daily ranking + SAVE TO DB',
          'GET /?action=weekly - Crawl weekly ranking + SAVE TO DB',
          'GET /?action=monthly - Crawl monthly ranking + SAVE TO DB',
          'GET /?action=home - Crawl homepage recommendations + SAVE TO DB',
          'POST / - Crawl from PID + SAVE TO DB'
        ],
        features: [
          '✅ Real Pixiv crawling',
          '✅ HTML parsing',
          '✅ PID extraction',
          '✅ Ranking generation',
          '✅ Database writing',
          '✅ Modular architecture',
          '✅ No Node.js dependencies',
          '✅ Backup PID extraction methods',
          '✅ Detailed logging and debugging'
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
      
      try {
        console.log('=== Starting single PID crawl ===');
        const headersList = getPixivHeaders();
        const pixivCrawler = new PixivCrawler(pid, headersList, null, 'single_' + Date.now(), popularityThreshold || 0.0, env);
        const supabase = new SupabaseService(env);
        
        const pids = await pixivCrawler.getPidsFromOriginPid(pid, targetNum || 100);
        console.log('Single PID crawl result:', pids.length);
        
        if (pids.length > 0) {
          await supabase.upsertMinimalPics(pids);
          
          return new Response(JSON.stringify({ 
            message: 'Single PID crawl completed and saved to database',
            pid,
            targetNum: targetNum || 100,
            popularityThreshold: popularityThreshold || 0.0,
            pids,
            count: pids.length,
            taskId: 'single_' + Date.now(),
            timestamp: new Date().toISOString(),
            databaseWrite: 'success'
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        } else {
          return new Response(JSON.stringify({ 
            message: 'Single PID crawl failed - no PIDs extracted',
            pid,
            targetNum: targetNum || 100,
            popularityThreshold: popularityThreshold || 0.0,
            pids: [],
            count: 0,
            taskId: 'single_' + Date.now(),
            timestamp: new Date().toISOString(),
            databaseWrite: 'skipped',
            error: 'No PIDs data to save'
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      } catch (error) {
        console.error('PID crawl failed:', error);
        return new Response(JSON.stringify({ 
          error: 'PID crawl failed',
          message: error instanceof Error ? error.message : String(error),
          taskId: 'single_' + Date.now(),
          timestamp: new Date().toISOString(),
          databaseWrite: 'failed'
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
    
    return new Response('Method not allowed', { status: 405 });
  }
};

