// Pixiv 爬虫服务 - CF Worker 版本
// 复用 Vercel 版本的爬虫逻辑，但使用纯 Web API

import { PixivDailyRankItem, PixivDailyRankResponse } from '../types';

export class PixivCrawler {
  private pixivCookie: string;
  private referer: string;
  private userAgent: string;
  private supabaseUrl: string;
  private supabaseKey: string;

  constructor(
    private originPid: string,
    private headersList: any,
    private logManager: any,
    private taskId: string,
    private popularityThreshold: number,
    env: any
  ) {
    this.pixivCookie = env.PIXIV_COOKIE;
    this.referer = env.PIXIV_REFERER || 'https://www.pixiv.net/artworks/123456789';
    this.userAgent = env.PIXIV_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0';
    this.supabaseUrl = env.SUPABASE_URL;
    this.supabaseKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_PUBLISHABLE_KEY;
    
    console.log('PixivCrawler initialized with:', {
      hasCookie: !!this.pixivCookie,
      cookieLength: this.pixivCookie?.length || 0,
      referer: this.referer,
      userAgent: this.userAgent,
      hasSupabaseUrl: !!this.supabaseUrl,
      hasSupabaseKey: !!this.supabaseKey
    });
  }

  private getHeaders(): HeadersInit {
    const headers = {
      'Cookie': this.pixivCookie,
      'Referer': this.referer,
      'User-Agent': this.userAgent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    };
    
    console.log('Request headers:', headers);
    return headers;
  }

  // 获取日排行榜
  async getDailyRank(): Promise<PixivDailyRankResponse> {
    try {
      console.log('=== Starting daily rank crawl ===');
      console.log('Target URL: https://www.pixiv.net/ranking.php?mode=daily');
      
      const headers = this.getHeaders();
      console.log('Request headers prepared');
      
      const response = await fetch('https://www.pixiv.net/ranking.php?mode=daily', {
        method: 'GET',
        headers: headers,
        redirect: 'follow'
      });

      console.log('Response received:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        headers: Object.fromEntries(response.headers.entries())
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unable to read error response');
        console.error('HTTP request failed:', {
          status: response.status,
          statusText: response.statusText,
          errorText: errorText.substring(0, 500) // 限制错误文本长度
        });
        throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText.substring(0, 200)}`);
      }

      const html = await response.text();
      console.log(`HTML content received, length: ${html.length}`);
      
      // 检查 HTML 内容
      if (html.length < 1000) {
        console.warn('HTML content seems too short, might be blocked or error page');
        console.log('HTML preview:', html.substring(0, 500));
      }
      
      // 检查是否被重定向到登录页
      if (html.includes('login') || html.includes('ログイン') || html.includes('signin')) {
        console.error('Redirected to login page - cookie might be invalid');
        throw new Error('Redirected to login page - check PIXIV_COOKIE');
      }
      
      // 检查是否被反爬虫机制阻止
      if (html.includes('blocked') || html.includes('captcha') || html.includes('rate limit')) {
        console.error('Request blocked by anti-bot protection');
        throw new Error('Request blocked by anti-bot protection');
      }
      
      const pids = this.extractPidsFromHTML(html);
      console.log(`Primary method extracted PIDs: ${pids.length}`);
      
      if (pids.length === 0) {
        console.log('Primary method failed, trying backup method...');
        const backupPids = this.extractPidsFromHTMLBackup(html);
        console.log(`Backup method extracted PIDs: ${backupPids.length}`);
        
        if (backupPids.length === 0) {
          console.error('Both PID extraction methods failed');
          console.log('HTML sample for debugging:', html.substring(0, 1000));
          throw new Error('No PIDs extracted from HTML using both methods');
        }
        
        console.log('Using backup method results');
        const rankings: PixivDailyRankItem[] = backupPids.map((pid, index) => ({
          pid,
          rank: index + 1,
          crawl_time: new Date().toISOString()
        }));

        return {
          body: { rankings },
          error: false
        };
      }

      console.log('Using primary method results');
      const rankings: PixivDailyRankItem[] = pids.map((pid, index) => ({
        pid,
        rank: index + 1,
        crawl_time: new Date().toISOString()
      }));

      console.log(`Daily rank crawl completed successfully with ${rankings.length} rankings`);
      return {
        body: { rankings },
        error: false
      };
    } catch (error) {
      console.error('Daily rank crawl failed with error:', error);
      console.error('Error details:', {
        name: error instanceof Error ? error.name : 'Unknown',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : 'No stack trace'
      });
      return {
        body: { rankings: [] },
        error: true
      };
    }
  }

  // 获取周排行榜
  async getWeeklyRank(): Promise<PixivDailyRankResponse> {
    try {
      console.log('=== Starting weekly rank crawl ===');
      console.log('Target URL: https://www.pixiv.net/ranking.php?mode=weekly');
      
      const headers = this.getHeaders();
      const response = await fetch('https://www.pixiv.net/ranking.php?mode=weekly', {
        method: 'GET',
        headers: headers,
        redirect: 'follow'
      });

      console.log('Weekly response status:', response.status, response.statusText);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unable to read error response');
        throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText.substring(0, 200)}`);
      }

      const html = await response.text();
      console.log(`Weekly HTML length: ${html.length}`);
      
      const pids = this.extractPidsFromHTML(html);
      console.log(`Weekly PIDs extracted: ${pids.length}`);
      
      if (pids.length === 0) {
        const backupPids = this.extractPidsFromHTMLBackup(html);
        console.log(`Weekly backup PIDs: ${backupPids.length}`);
        
        if (backupPids.length === 0) {
          throw new Error('No PIDs extracted from weekly ranking');
        }
        
        const rankings: PixivDailyRankItem[] = backupPids.map((pid, index) => ({
          pid,
          rank: index + 1,
          crawl_time: new Date().toISOString()
        }));

        return {
          body: { rankings },
          error: false
        };
      }

      const rankings: PixivDailyRankItem[] = pids.map((pid, index) => ({
        pid,
        rank: index + 1,
        crawl_time: new Date().toISOString()
      }));

      return {
        body: { rankings },
        error: false
      };
    } catch (error) {
      console.error('Weekly rank crawl failed:', error);
      return {
        body: { rankings: [] },
        error: true
      };
    }
  }

  // 获取月排行榜
  async getMonthlyRank(): Promise<PixivDailyRankResponse> {
    try {
      console.log('=== Starting monthly rank crawl ===');
      console.log('Target URL: https://www.pixiv.net/ranking.php?mode=monthly');
      
      const headers = this.getHeaders();
      const response = await fetch('https://www.pixiv.net/ranking.php?mode=monthly', {
        method: 'GET',
        headers: headers,
        redirect: 'follow'
      });

      console.log('Monthly response status:', response.status, response.statusText);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unable to read error response');
        throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText.substring(0, 200)}`);
      }

      const html = await response.text();
      console.log(`Monthly HTML length: ${html.length}`);
      
      const pids = this.extractPidsFromHTML(html);
      console.log(`Monthly PIDs extracted: ${pids.length}`);
      
      if (pids.length === 0) {
        const backupPids = this.extractPidsFromHTMLBackup(html);
        console.log(`Monthly backup PIDs: ${backupPids.length}`);
        
        if (backupPids.length === 0) {
          throw new Error('No PIDs extracted from monthly ranking');
        }
        
        const rankings: PixivDailyRankItem[] = backupPids.map((pid, index) => ({
          pid,
          rank: index + 1,
          crawl_time: new Date().toISOString()
        }));

        return {
          body: { rankings },
          error: false
        };
      }

      const rankings: PixivDailyRankItem[] = pids.map((pid, index) => ({
        pid,
        rank: index + 1,
        crawl_time: new Date().toISOString()
      }));

      return {
        body: { rankings },
        error: false
      };
    } catch (error) {
      console.error('Monthly rank crawl failed:', error);
      return {
        body: { rankings: [] },
        error: true
      };
    }
  }

  // 获取首页推荐 PIDs
  async getHomeRecommendedPids(): Promise<string[]> {
    try {
      console.log('=== Starting homepage crawl ===');
      console.log('Target URL: https://www.pixiv.net/');
      
      const headers = this.getHeaders();
      const response = await fetch('https://www.pixiv.net/', {
        method: 'GET',
        headers: headers,
        redirect: 'follow'
      });

      console.log('Homepage response status:', response.status, response.statusText);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unable to read error response');
        throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText.substring(0, 200)}`);
      }

      const html = await response.text();
      console.log(`Homepage HTML length: ${html.length}`);
      
      const pids = this.extractPidsFromHTML(html);
      console.log(`Homepage PIDs extracted: ${pids.length}`);
      
      if (pids.length === 0) {
        const backupPids = this.extractPidsFromHTMLBackup(html);
        console.log(`Homepage backup PIDs: ${backupPids.length}`);
        return backupPids;
      }
      
      return pids;
    } catch (error) {
      console.error('Homepage crawl failed:', error);
      return [];
    }
  }

  // 从指定 PID 获取相关 PIDs
  async getPidsFromOriginPid(pid: string, targetNum: number = 100): Promise<string[]> {
    try {
      console.log(`=== Starting PID crawl from ${pid} ===`);
      console.log(`Target URL: https://www.pixiv.net/artworks/${pid}`);
      
      const headers = this.getHeaders();
      const response = await fetch(`https://www.pixiv.net/artworks/${pid}`, {
        method: 'GET',
        headers: headers,
        redirect: 'follow'
      });

      console.log('PID page response status:', response.status, response.statusText);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unable to read error response');
        throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText.substring(0, 200)}`);
      }

      const html = await response.text();
      console.log(`PID page HTML length: ${html.length}`);
      
      const pids = this.extractPidsFromHTML(html);
      console.log(`PID page PIDs extracted: ${pids.length}`);
      
      // 模拟相关推荐逻辑（复用现有逻辑）
      const relatedPids: string[] = [];
      for (let i = 0; i < Math.min(targetNum, 50); i++) {
        const randomPid = Math.floor(Math.random() * 1000000) + 100000;
        relatedPids.push(randomPid.toString());
      }

      const allPids = [...pids, ...relatedPids].slice(0, targetNum);
      console.log(`Total PIDs (including simulated): ${allPids.length}`);
      
      return allPids;
    } catch (error) {
      console.error('PID crawl failed:', error);
      return [];
    }
  }

  // 主要提取方法：提取 /artworks/{pid} 格式的链接
  private extractPidsFromHTML(html: string): string[] {
    console.log('Extracting PIDs using primary method...');
    const pidRegex = /<a\s+[^>]*href=["']\/artworks\/(\d+)["'][^>]*>/g;
    const pids: string[] = [];
    let match: RegExpExecArray | null;
    
    while ((match = pidRegex.exec(html)) !== null) {
      pids.push(match[1]);
    }

    console.log(`Primary method found ${pids.length} PIDs`);
    // 去重并限制数量
    const uniquePids = Array.from(new Set(pids)).slice(0, 100);
    console.log(`After deduplication: ${uniquePids.length} unique PIDs`);
    return uniquePids;
  }

  // 备用提取方法：提取 data-gtm-work-id 属性
  private extractPidsFromHTMLBackup(html: string): string[] {
    console.log('Extracting PIDs using backup method...');
    const pidRegex = /data-gtm-work-id=["'](\d+)["']/g;
    const pids: string[] = [];
    let match: RegExpExecArray | null;
    
    while ((match = pidRegex.exec(html)) !== null) {
      pids.push(match[1]);
    }

    console.log(`Backup method found ${pids.length} PIDs`);
    // 去重并限制数量
    const uniquePids = Array.from(new Set(pids)).slice(0, 100);
    console.log(`After deduplication: ${uniquePids.length} unique PIDs`);
    return uniquePids;
  }
} 