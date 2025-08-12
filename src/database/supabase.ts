import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { DatabasePic, PixivDailyRankItem } from '../types';

export class SupabaseService {
  private client: SupabaseClient;

  /**
   * SupabaseService构造函数
   * @param supabaseUrl Supabase项目URL
   * @param supabaseKey Supabase服务角色密钥（SUPABASE_SERVICE_ROLE_KEY）
   */
  constructor(supabaseUrl?: string, supabaseKey?: string) {
    const url = supabaseUrl || (typeof process !== 'undefined' ? process.env.SUPABASE_URL : undefined);
    // 使用 SUPABASE_SERVICE_ROLE_KEY
    const key = supabaseKey || 
                (typeof process !== 'undefined' ? process.env.SUPABASE_SERVICE_ROLE_KEY : undefined);

    if (!url || !key) {
      throw new Error('Missing Supabase environment variables: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
    }

    // 创建客户端
    this.client = createClient(url, key);
    
    // 输出调试信息（不包含完整密钥）
    console.log('Supabase客户端初始化:', {
      url: url?.substring(0, 30) + '...',
      keyType: key.startsWith('eyJ') ? 'Secret Key' : 
               key.includes('anon') ? 'Anon Key' : 
               key.includes('publishable') ? 'Publishable Key' : 'Unknown Key Type',
      keyPrefix: key.substring(0, 20) + '...'
    });
  }

  // Pic表操作
  async createPic(pic: DatabasePic): Promise<void> {
    console.log('尝试创建Pic记录:', { pid: pic.pid });
    
    const { data, error } = await this.client
      .from('pic')
      .insert([pic])
      .select();

    if (error) {
      console.error('创建Pic失败:', {
        error: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        pid: pic.pid
      });
      
      // 如果是权限错误，提供更详细的错误信息
      if (error.code === '42501' || error.message.includes('permission') || error.message.includes('policy')) {
        throw new Error(`数据库权限错误: ${error.message}. 请确保使用的是 SUPABASE_SERVICE_ROLE_KEY`);
      }
      
      throw error;
    }
    
    console.log('创建Pic完成:', { pid: pic.pid, inserted: data?.length || 0 });
  }

  async getPicByPid(pid: string): Promise<DatabasePic | null> {
    const { data, error } = await this.client
      .from('pic')
      .select('*')
      .eq('pid', pid)
      .single();

    if (error) {
      console.error('Error getting pic:', error);
      return null;
    }

    return data;
  }

  async updatePicDownload(pid: string, path: string, imgUrl: string, fileSize?: number): Promise<void> {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const updateData: any = { 
      image_path: path, 
      image_url: imgUrl, 
      download_time: now 
    };
    
    // 如果提供了文件大小，则更新size列
    if (fileSize !== undefined) {
      updateData.size = fileSize;
    }
    
    const { error } = await this.client
      .from('pic')
      .update(updateData)
      .eq('pid', pid);

    if (error) {
      console.error('Error updating pic download:', error);
      throw error;
    }
    console.log('更新Pic下载路径、图片地址和文件大小完成');
  }

  async updatePic(pic: Partial<DatabasePic> & { pid: string }): Promise<void> {
    const { pid, ...updateData } = pic;
    const { error } = await this.client
      .from('pic')
      .update(updateData)
      .eq('pid', pid);

    if (error) {
      console.error('Error updating pic:', error);
      throw error;
    }
    console.log('更新Pic完成');
  }

  async getPicsByTags(tags: string[], unsupportTags: string[] = [], limit: number = 6): Promise<string[]> {
    let query = this.client
      .from('pic')
      .select('pid');

    // 添加标签过滤条件
    if (tags.length > 0) {
      tags.forEach(tag => {
        query = query.ilike('tag', `%${tag}%`);
      });
    }

    // 添加不支持标签过滤条件
    if (unsupportTags.length > 0) {
      unsupportTags.forEach(tag => {
        query = query.not('tag', 'ilike', `%${tag}%`);
      });
    }

    // 添加其他条件
    query = query.is('unfit', false);

    const { data, error } = await query.limit(limit);

    if (error) {
      console.error('Error getting pics by tags:', error);
      return [];
    }

    return data?.map(pic => pic.pid) || [];
  }

  // 检查图片是否已下载
  async checkPicDownload(pid: string): Promise<string | null> {
    const pic = await this.getPicByPid(pid);
    return pic?.image_path || null;
  }

  // 检查图片是否已上传
  async checkPicUpload(pid: string): Promise<boolean> {
    const pic = await this.getPicByPid(pid);
    return !!pic?.wx_name;
  }

  // 统计方法
  async getTotalPicsCount(): Promise<number> {
    const { count, error } = await this.client
      .from('pic')
      .select('*', { count: 'exact', head: true });

    if (error) {
      console.error('Error getting total pics count:', error);
      return 0;
    }

    return count || 0;
  }

  async getDownloadedPicsCount(): Promise<number> {
    const { count, error } = await this.client
      .from('pic')
      .select('*', { count: 'exact', head: true })
      .not('image_path', 'is', null);

    if (error) {
      console.error('Error getting downloaded pics count:', error);
      return 0;
    }

    return count || 0;
  }

  async getAveragePopularity(): Promise<number> {
    try {
      const { data, error } = await this.client
        .from('pic')
        .select('popularity');

      if (error) {
        console.error('Error getting average popularity:', error);
        return 0;
      }

      if (!data || data.length === 0) {
        return 0;
      }

      const totalPopularity = data.reduce((sum, pic) => sum + (pic.popularity || 0), 0);
      return Number((totalPopularity / data.length).toFixed(2));
    } catch (error) {
      console.error('Error getting average popularity:', error);
      return 0;
    }
  }

  // 排行榜写入/更新
  async upsertRankings(items: PixivDailyRankItem[], rankDate: string, type: 'daily' | 'weekly' | 'monthly'): Promise<void> {
    if (!items || items.length === 0) {
      console.log('排行榜数据为空，跳过写入');
      return;
    }

    console.log('尝试写入排行榜数据:', { 
      type, 
      rankDate, 
      count: items.length,
      samplePids: items.slice(0, 3).map(i => i.pid)
    });

    // 组装数据库行
    const rows = items.map(item => ({
      pid: item.pid,
      rank: item.rank,
      rank_type: type,
      rank_date: rankDate,
      crawl_time: new Date(item.crawl_time)
    }));

    const { data, error } = await this.client
      .from('ranking')
      .upsert(rows, {
        onConflict: 'rank_type,rank_date,pid'
      })
      .select();

    if (error) {
      console.error('排行榜写入失败:', {
        error: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        type,
        rankDate,
        itemCount: items.length
      });
      
      // 如果是权限错误，提供更详细的错误信息
      if (error.code === '42501' || error.message.includes('permission') || error.message.includes('policy')) {
        throw new Error(`数据库权限错误: ${error.message}. 请确保使用的是 SUPABASE_SERVICE_ROLE_KEY`);
      }
      
      throw error;
    }
    
    console.log('排行榜写入完成:', { 
      type, 
      rankDate, 
      inserted: data?.length || 0,
      expected: items.length 
    });
  }

  // 最小化插入/更新 Pic，仅按 pid upsert，避免重复错误
  async upsertMinimalPics(pids: string[]): Promise<void> {
    const uniquePids = Array.from(new Set(pids));
    if (uniquePids.length === 0) return;

    const rows = uniquePids.map(pid => ({ pid }));
    const { error } = await this.client
      .from('pic')
      .upsert(rows, { onConflict: 'pid' });

    if (error) {
      console.error('Error upserting minimal pics:', error);
      throw error;
    }
  }
}