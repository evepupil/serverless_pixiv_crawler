// Supabase 数据库服务 - CF Worker 版本
// 复用 Vercel 版本的数据库操作逻辑

import { PixivDailyRankItem } from '../types';

export class SupabaseService {
  private supabaseUrl: string;
  private supabaseKey: string;

  constructor(env: any) {
    this.supabaseUrl = env.SUPABASE_URL;
    this.supabaseKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_PUBLISHABLE_KEY;

    if (!this.supabaseUrl || !this.supabaseKey) {
      throw new Error('Missing Supabase environment variables');
    }
  }

  // 写入排行榜数据
  async upsertRankings(items: PixivDailyRankItem[], rankDate: string, type: 'daily' | 'weekly' | 'monthly'): Promise<void> {
    if (!items || items.length === 0) return;

    const rows = items.map(item => ({
      pid: item.pid,
      rank: item.rank,
      rank_type: type,
      rank_date: rankDate,
      crawl_time: new Date(item.crawl_time)
    }));

    try {
      const response = await fetch(`${this.supabaseUrl}/rest/v1/ranking`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.supabaseKey}`,
          'apikey': this.supabaseKey,
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify(rows)
      });

      if (!response.ok) {
        throw new Error(`Database write failed: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      console.error(`Error upserting ${type} rankings:`, error);
      throw error;
    }
  }

  // 写入图片数据（最小化）
  async upsertMinimalPics(pids: string[]): Promise<void> {
    if (!pids || pids.length === 0) return;

    const uniquePids = Array.from(new Set(pids));
    const rows = uniquePids.map(pid => ({ 
      pid,
      created_at: new Date().toISOString()
    }));

    try {
      const response = await fetch(`${this.supabaseUrl}/rest/v1/pic`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.supabaseKey}`,
          'apikey': this.supabaseKey,
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify(rows)
      });

      if (!response.ok) {
        throw new Error(`Database write failed: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      console.error('Error upserting minimal pics:', error);
      throw error;
    }
  }

  // 获取总图片数
  async getTotalPicsCount(): Promise<number> {
    try {
      const response = await fetch(`${this.supabaseUrl}/rest/v1/pic?select=*&count=exact`, {
        headers: {
          'Authorization': `Bearer ${this.supabaseKey}`,
          'apikey': this.supabaseKey
        }
      });

      if (!response.ok) {
        throw new Error(`Database query failed: ${response.status} ${response.statusText}`);
      }

      const count = response.headers.get('content-range');
      if (count) {
        const match = count.match(/\/(\d+)$/);
        return match ? parseInt(match[1]) : 0;
      }
      return 0;
    } catch (error) {
      console.error('Error getting total pics count:', error);
      return 0;
    }
  }

  // 获取已下载图片数
  async getDownloadedPicsCount(): Promise<number> {
    try {
      const response = await fetch(`${this.supabaseUrl}/rest/v1/pic?select=*&image_path=not.is.null&count=exact`, {
        headers: {
          'Authorization': `Bearer ${this.supabaseKey}`,
          'apikey': this.supabaseKey
        }
      });

      if (!response.ok) {
        throw new Error(`Database query failed: ${response.status} ${response.statusText}`);
      }

      const count = response.headers.get('content-range');
      if (count) {
        const match = count.match(/\/(\d+)$/);
        return match ? parseInt(match[1]) : 0;
      }
      return 0;
    } catch (error) {
      console.error('Error getting downloaded pics count:', error);
      return 0;
    }
  }
} 