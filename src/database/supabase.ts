import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { DatabasePic } from '../types';

export class SupabaseService {
  private client: SupabaseClient;

  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase environment variables');
    }

    this.client = createClient(supabaseUrl, supabaseKey);
  }

  // Pic表操作
  async createPic(pic: DatabasePic): Promise<void> {
    const { error } = await this.client
      .from('pic')
      .insert([pic]);

    if (error) {
      console.error('Error creating pic:', error);
      throw error;
    }
    console.log('创建Pic完成');
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

  async updatePicDownload(pid: string, path: string, imgUrl: string): Promise<void> {
    const { error } = await this.client
      .from('pic')
      .update({ image_path: path, image_url: imgUrl })
      .eq('pid', pid);

    if (error) {
      console.error('Error updating pic download:', error);
      throw error;
    }
    console.log('更新Pic下载路径和图片地址完成');
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
    const { data, error } = await this.client
      .from('pic')
      .select('popularity');

    if (error || !data || data.length === 0) {
      console.error('Error getting average popularity:', error);
      return 0;
    }

    const totalPopularity = data.reduce((sum, pic) => sum + (pic.popularity || 0), 0);
    return totalPopularity / data.length;
  }
} 