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

  /**
   * 直接从pic_stats视图获取统计数据
   * @returns Promise<{totalPics: number, downloadedPics: number, avgPopularity: number}>
   */
  async getStatsFromView(): Promise<{totalPics: number, downloadedPics: number, avgPopularity: number}> {
    try {
      const { data, error } = await this.client
        .from('pic_stats')
        .select('total_pics, downloaded_pics, avg_popularity')
        .single();

      if (error) {
        console.error('Error getting stats from view:', error);
        return { totalPics: 0, downloadedPics: 0, avgPopularity: 0 };
      }

      return {
        totalPics: data?.total_pics || 0,
        downloadedPics: data?.downloaded_pics || 0,
        avgPopularity: Number((data?.avg_popularity || 0).toFixed(2))
      };
    } catch (error) {
      console.error('Error getting stats from view:', error);
      return { totalPics: 0, downloadedPics: 0, avgPopularity: 0 };
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

  /**
   * 从数据库中随机获取指定数量的pid
   * @param count 需要获取的pid数量，默认10个
   * @returns 随机pid数组
   */
  async getRandomPids(count: number = 10): Promise<string[]> {
    try {
      console.log(`尝试从数据库随机获取${count}个PID`);
      
      // 使用rpc调用来执行随机查询，因为Supabase的order不支持random()函数
      const { data, error } = await this.client.rpc('get_random_pids', {
        limit_count: count
      });

      if (error) {
        console.error('随机获取PID失败:', error);
        // 如果rpc失败，尝试备用方案：获取总数然后随机选择
        return await this.getRandomPidsFallback(count);
      }

      const pids = data?.map((item: any) => item.pid) || [];
      console.log(`成功获取${pids.length}个随机PID:`, pids.slice(0, 3), pids.length > 3 ? '...' : '');
      
      return pids;
    } catch (error) {
      console.error('随机获取PID异常:', error);
      // 使用备用方案
      return await this.getRandomPidsFallback(count);
    }
  }

  /**
   * 备用方案：通过获取总数和随机偏移来获取随机PID
   * @param count 需要获取的PID数量
   * @returns Promise<string[]> PID数组
   */
  private async getRandomPidsFallback(count: number): Promise<string[]> {
    try {
      console.log('使用备用方案获取随机PID');
      
      // 先获取总数
      const { count: totalCount, error: countError } = await this.client
        .from('pic')
        .select('*', { count: 'exact', head: true });

      if (countError || !totalCount || totalCount === 0) {
        console.error('获取总数失败或数据为空:', countError);
        return [];
      }

      // 生成随机偏移量
      const maxOffset = Math.max(0, totalCount - count);
      const randomOffset = Math.floor(Math.random() * (maxOffset + 1));
      
      console.log(`总数: ${totalCount}, 随机偏移: ${randomOffset}`);

      // 使用偏移量获取数据
      const { data, error } = await this.client
        .from('pic')
        .select('pid')
        .range(randomOffset, randomOffset + count - 1);

      if (error) {
        console.error('备用方案获取PID失败:', error);
        return [];
      }

      const pids = data?.map(item => item.pid) || [];
      console.log(`备用方案成功获取${pids.length}个PID`);
      return pids;
    } catch (error) {
      console.error('备用方案异常:', error);
      return [];
    }
  }

  // ===== pic_task表操作方法 =====

  /**
   * 创建或更新pic_task记录
   * @param pid 图片ID
   * @returns Promise<void>
   */
  async createOrUpdatePicTask(pid: string): Promise<void> {
    try {
      console.log('创建或更新pic_task记录:', { pid });
      
      const { data, error } = await this.client
        .from('pic_task')
        .upsert([{ pid }], { onConflict: 'pid' })
        .select();

      if (error) {
        console.error('创建或更新pic_task失败:', error);
        throw error;
      }
      
      console.log('创建或更新pic_task完成:', { pid });
    } catch (error) {
      console.error('创建或更新pic_task异常:', error);
      throw error;
    }
  }

  /**
   * 更新插画推荐爬取状态
   * @param pid 图片ID
   * @param count 获取到的推荐数量
   * @returns Promise<void>
   */
  async updateIllustRecommendStatus(pid: string, count: number = 0): Promise<void> {
    try {
      const { error } = await this.client
        .from('pic_task')
        .update({
          illust_recommend_crawled: true,
          illust_recommend_time: new Date().toISOString(),
          illust_recommend_count: count
        })
        .eq('pid', pid);

      if (error) {
        console.error('更新插画推荐状态失败:', error);
        throw error;
      }
      
      console.log('更新插画推荐状态完成:', { pid, count });
    } catch (error) {
      console.error('更新插画推荐状态异常:', error);
      throw error;
    }
  }

  /**
   * 更新作者推荐爬取状态
   * @param pid 图片ID
   * @param count 获取到的推荐数量
   * @returns Promise<void>
   */
  async updateAuthorRecommendStatus(pid: string, count: number = 0): Promise<void> {
    try {
      const { error } = await this.client
        .from('pic_task')
        .update({
          author_recommend_crawled: true,
          author_recommend_time: new Date().toISOString(),
          author_recommend_count: count
        })
        .eq('pid', pid);

      if (error) {
        console.error('更新作者推荐状态失败:', error);
        throw error;
      }
      
      console.log('更新作者推荐状态完成:', { pid, count });
    } catch (error) {
      console.error('更新作者推荐状态异常:', error);
      throw error;
    }
  }

  /**
   * 更新详细信息爬取状态
   * @param pid 图片ID
   * @returns Promise<void>
   */
  async updateDetailInfoStatus(pid: string): Promise<void> {
    try {
      const { error } = await this.client
        .from('pic_task')
        .update({
          detail_info_crawled: true,
          detail_info_time: new Date().toISOString()
        })
        .eq('pid', pid);

      if (error) {
        console.error('更新详细信息状态失败:', error);
        throw error;
      }
      
      console.log('更新详细信息状态完成:', { pid });
    } catch (error) {
      console.error('更新详细信息状态异常:', error);
      throw error;
    }
  }

  /**
   * 获取pic_task记录
   * @param pid 图片ID
   * @returns Promise<any | null>
   */
  async getPicTask(pid: string): Promise<any | null> {
    try {
      const { data, error } = await this.client
        .from('pic_task')
        .select('*')
        .eq('pid', pid)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // 记录不存在
          return null;
        }
        console.error('获取pic_task记录失败:', error);
        throw error;
      }

      return data;
    } catch (error) {
      console.error('获取pic_task记录异常:', error);
      throw error;
    }
  }

  /**
   * 获取未完成指定任务的PID列表
   * @param taskType 任务类型: 'illust_recommend' | 'author_recommend' | 'detail_info'
   * @param limit 限制数量，默认100
   * @returns Promise<string[]>
   */
  async getUncompletedTasks(taskType: 'illust_recommend' | 'author_recommend' | 'detail_info', limit: number = 100): Promise<string[]> {
    try {
      const columnMap = {
        'illust_recommend': 'illust_recommend_crawled',
        'author_recommend': 'author_recommend_crawled',
        'detail_info': 'detail_info_crawled'
      };

      const column = columnMap[taskType];
      const { data, error } = await this.client
        .from('pic_task')
        .select('pid')
        .eq(column, false)
        .limit(limit);

      if (error) {
        console.error('获取未完成任务失败:', error);
        throw error;
      }

      return data?.map(item => item.pid) || [];
    } catch (error) {
      console.error('获取未完成任务异常:', error);
      throw error;
    }
  }

  /**
   * 批量创建pic_task记录
   * @param pids PID数组
   * @returns Promise<void>
   */
  async batchCreatePicTasks(pids: string[]): Promise<void> {
    if (!pids || pids.length === 0) return;
    
    try {
      const uniquePids = Array.from(new Set(pids));
      const rows = uniquePids.map(pid => ({ pid }));
      
      console.log('批量创建pic_task记录:', { count: rows.length });
      
      const { error } = await this.client
        .from('pic_task')
        .upsert(rows, { onConflict: 'pid' });

      if (error) {
        console.error('批量创建pic_task失败:', error);
        throw error;
      }
      
      console.log('批量创建pic_task完成:', { count: rows.length });
    } catch (error) {
      console.error('批量创建pic_task异常:', error);
      throw error;
    }
  }
}