import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import axios, { AxiosInstance, AxiosResponse } from 'axios';
import * as cheerio from 'cheerio';
import { 
  PixivHeaders, 
  PixivIllustPagesResponse, 
  DownloadResult, 
  R2Config 
} from '../types';
import { SupabaseService } from '../database/supabase';

// 日志管理器接口
interface ILogManager {
  addLog(message: string, type: 'info' | 'error' | 'warning' | 'success', taskId?: string): void;
}

export class PixivDownloader {
  private headers: PixivHeaders;
  private httpClient: AxiosInstance;
  private r2Client: S3Client;
  private supabase: SupabaseService;
  private logManager: ILogManager;
  private taskId: string;
  private r2Config: R2Config;

  constructor(
    headers: PixivHeaders, 
    r2Config: R2Config, 
    logManager: ILogManager, 
    taskId: string
  ) {
    this.headers = headers;
    this.r2Config = r2Config;
    this.logManager = logManager;
    this.taskId = taskId;
    this.supabase = new SupabaseService();

    // 初始化HTTP客户端
    this.httpClient = axios.create({
      timeout: 15000, // 减少超时时间到15秒
      headers: this.headers as any
    });

    // 初始化R2客户端
    this.r2Client = new S3Client({
      region: this.r2Config.region,
      endpoint: `https://${this.r2Config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: this.r2Config.accessKeyId,
        secretAccessKey: this.r2Config.secretAccessKey,
      },
    });
  }

  /**
   * 获取插画页面信息
   */
  private async getIllustPages(pid: string): Promise<PixivIllustPagesResponse | null> {
    try {
      this.logManager.addLog(`获取插画 ${pid} 页面信息`, 'info', this.taskId);
      
      const response = await this.httpClient.get(
        `https://www.pixiv.net/ajax/illust/${pid}/pages?lang=zh`
      );

      const resJson: PixivIllustPagesResponse = response.data;
      
      if (resJson.error === false && resJson.body && resJson.body.length > 0) {
        this.logManager.addLog(`获取插画 ${pid} 页面信息成功，共 ${resJson.body.length} 张图片`, 'info', this.taskId);
        
        // 打印所有可用的图片尺寸和链接
        const urls = resJson.body[0].urls;
        this.logManager.addLog(`插画 ${pid} 可用图片尺寸:`, 'info', this.taskId);
        Object.entries(urls).forEach(([size, url]) => {
          this.logManager.addLog(`  ${size}: ${url}`, 'info', this.taskId);
        });
        
        return resJson;
      } else {
        this.logManager.addLog(`获取插画 ${pid} 页面信息失败或为空`, 'warning', this.taskId);
        return null;
      }
    } catch (error) {
      this.logManager.addLog(`获取插画 ${pid} 页面信息异常: ${error instanceof Error ? error.message : String(error)}`, 'error', this.taskId);
      return null;
    }
  }

  /**
   * 获取画师名字
   */
  private async getArtistName(pid: string): Promise<string | null> {
    try {
      const artworksUrl = `https://www.pixiv.net/artworks/${pid}`;
      const response = await this.httpClient.get(artworksUrl);
      
      const $ = cheerio.load(response.data);
      const metaTags = $('meta').toArray();
      
      // 查找包含userName的meta标签
      for (const meta of metaTags) {
        const content = $(meta).attr('content');
        if (content) {
          const userNameMatch = content.match(/"userName":"([^"]+)"/);
          if (userNameMatch) {
            const userName = userNameMatch[1];
            // 清理文件名中的非法字符
            const sanitizedName = userName.replace(/[/\\| ]/g, '_');
            this.logManager.addLog(`获取到画师名字: ${userName}`, 'info', this.taskId);
            return sanitizedName;
          }
        }
      }
      
      this.logManager.addLog(`未找到插画 ${pid} 的画师名字`, 'warning', this.taskId);
      return null;
    } catch (error) {
      this.logManager.addLog(`获取画师名字异常: ${error instanceof Error ? error.message : String(error)}`, 'error', this.taskId);
      return null;
    }
  }

  /**
   * 清理文件名
   */
  private sanitizeFilename(filename: string): string {
    return filename.replace(/[<>:"/\\|?*]/g, '_');
  }

  /**
   * 检查文件是否已存在于R2
   */
  private async checkFileExists(key: string): Promise<boolean> {
    try {
      await this.r2Client.send(new HeadObjectCommand({
        Bucket: this.r2Config.bucketName,
        Key: key
      }));
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * 上传文件到R2
   */
  private async uploadToR2(key: string, buffer: Buffer, contentType: string): Promise<boolean> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.r2Config.bucketName,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000', // 1年缓存
      });

      await this.r2Client.send(command);
      this.logManager.addLog(`文件上传到R2成功: ${key}`, 'success', this.taskId);
      return true;
    } catch (error) {
      this.logManager.addLog(`文件上传到R2失败: ${error instanceof Error ? error.message : String(error)}`, 'error', this.taskId);
      return false;
    }
  }

  /**
   * 下载图片
   */
  private async downloadImage(url: string): Promise<Buffer | null> {
    try {
      this.logManager.addLog(`发起HTTP请求下载图片: ${url}`, 'info', this.taskId);
      const response: AxiosResponse<Buffer> = await this.httpClient.get(url, {
        responseType: 'arraybuffer',
        headers: {
          ...this.headers,
          'Referer': 'https://www.pixiv.net/'
        }
      });

      if (response.status === 200) {
        const buffer = Buffer.from(response.data);
        this.logManager.addLog(`图片下载成功，状态码: ${response.status}，数据大小: ${(buffer.length / 1024 / 1024).toFixed(2)}MB`, 'success', this.taskId);
        return buffer;
      } else {
        this.logManager.addLog(`下载图片失败，状态码: ${response.status}`, 'error', this.taskId);
        return null;
      }
    } catch (error) {
      this.logManager.addLog(`下载图片异常: ${error instanceof Error ? error.message : String(error)}`, 'error', this.taskId);
      return null;
    }
  }

  /**
   * 下载指定PID的图片
   */
  async downloadIllust(pid: string): Promise<DownloadResult> {
    const result: DownloadResult = {
      success: false,
      pid
    };

    try {
      // 检查是否已下载
      const existingPath = await this.supabase.checkPicDownload(pid);
      if (existingPath) {
        this.logManager.addLog(`插画 ${pid} 已下载，跳过`, 'info', this.taskId);
        result.success = true;
        result.imageUrl = existingPath;
        return result;
      }

      // 获取插画页面信息
      const pagesResponse = await this.getIllustPages(pid);
      if (!pagesResponse || pagesResponse.body.length === 0) {
        result.error = '未找到插画页面信息';
        return result;
      }

      // 获取画师名字
      const artistName = await this.getArtistName(pid);
      result.artistName = artistName || undefined;

      // 图片尺寸优先级
      const imgSizes = ['original', 'regular', 'small', 'thumb_mini'];
      
      this.logManager.addLog(`开始尝试下载插画 ${pid}，按优先级尝试尺寸: ${imgSizes.join(' → ')}`, 'info', this.taskId);
      
      for (const size of imgSizes) {
        const urls = pagesResponse.body[0].urls;
        const imageUrl = urls[size as keyof typeof urls];
        if (!imageUrl) {
          this.logManager.addLog(`插画 ${pid} 的 ${size} 尺寸图片链接不存在，跳过`, 'warning', this.taskId);
          continue;
        }

        this.logManager.addLog(`开始下载 ${pid} 的 ${size} 尺寸图片: ${imageUrl}`, 'info', this.taskId);

        // 下载图片
        this.logManager.addLog(`正在下载图片数据: ${imageUrl}`, 'info', this.taskId);
        const imageBuffer = await this.downloadImage(imageUrl);
        if (!imageBuffer) {
          this.logManager.addLog(`图片下载失败: ${imageUrl}`, 'error', this.taskId);
          continue;
        }
        
        this.logManager.addLog(`图片下载成功，文件大小: ${(imageBuffer.length / 1024 / 1024).toFixed(2)}MB`, 'success', this.taskId);

        // 检查文件大小（限制为10MB）
        const fileSizeMB = imageBuffer.length / (1024 * 1024);
        this.logManager.addLog(`检查文件大小: ${fileSizeMB.toFixed(2)}MB`, 'info', this.taskId);
        if (fileSizeMB > 10) {
          this.logManager.addLog(`图片 ${pid} ${size} 尺寸过大 (${fileSizeMB.toFixed(2)}MB)，跳过`, 'warning', this.taskId);
          continue;
        }

        // 获取文件扩展名
        const urlParts = imageUrl.split('.');
        const extension = urlParts[urlParts.length - 1].split('?')[0]; // 移除查询参数
        const contentType = this.getContentType(extension);
        this.logManager.addLog(`文件扩展名: ${extension}, Content-Type: ${contentType}`, 'info', this.taskId);

        // 生成文件名
        const artistPrefix = artistName ? `@${artistName}` : '';
        const filename = this.sanitizeFilename(`${artistPrefix} pid_${pid}.${extension}`);
        const r2Key = `pixiv/${pid}/${filename}`;
        this.logManager.addLog(`生成R2存储路径: ${r2Key}`, 'info', this.taskId);

        // 检查文件是否已存在
        this.logManager.addLog(`检查R2中是否已存在文件: ${r2Key}`, 'info', this.taskId);
        const exists = await this.checkFileExists(r2Key);
        if (exists) {
          this.logManager.addLog(`文件 ${r2Key} 已存在于R2，跳过上传`, 'info', this.taskId);
          // 即使文件已存在，也要更新数据库中的文件大小
          const r2Url = `https://${this.r2Config.accountId}.r2.cloudflarestorage.com/${this.r2Config.bucketName}/${r2Key}`;
          this.logManager.addLog(`更新数据库记录，R2 URL: ${r2Url}`, 'info', this.taskId);
          await this.supabase.updatePicDownload(pid, r2Url, imageUrl, imageBuffer.length);
          
          result.success = true;
          result.imageUrl = imageUrl;
          result.r2Path = r2Key;
          result.fileSize = imageBuffer.length;
          this.logManager.addLog(`插画 ${pid} 处理完成（文件已存在）`, 'success', this.taskId);
          break;
        }
        
        this.logManager.addLog(`文件不存在，开始上传到R2: ${r2Key}`, 'info', this.taskId);

        // 上传到R2
        this.logManager.addLog(`开始上传文件到R2，文件大小: ${(imageBuffer.length / 1024 / 1024).toFixed(2)}MB`, 'info', this.taskId);
        const uploadSuccess = await this.uploadToR2(r2Key, imageBuffer, contentType);
        if (uploadSuccess) {
          // 更新数据库
          const r2Url = `https://${this.r2Config.accountId}.r2.cloudflarestorage.com/${this.r2Config.bucketName}/${r2Key}`;
          this.logManager.addLog(`R2上传成功，更新数据库记录，R2 URL: ${r2Url}`, 'info', this.taskId);
          await this.supabase.updatePicDownload(pid, r2Url, imageUrl, imageBuffer.length);
          
          result.success = true;
          result.imageUrl = imageUrl;
          result.r2Path = r2Key;
          result.fileSize = imageBuffer.length;
          
          this.logManager.addLog(`插画 ${pid} 下载完成，文件大小: ${fileSizeMB.toFixed(2)}MB`, 'success', this.taskId);
          break;
        } else {
          this.logManager.addLog(`R2上传失败，尝试下一个尺寸`, 'error', this.taskId);
        }
      }

      if (!result.success) {
        result.error = '所有尺寸的图片下载都失败了';
        this.logManager.addLog(`插画 ${pid} 所有尺寸下载都失败，跳过此插画`, 'error', this.taskId);
      }

    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      this.logManager.addLog(`下载插画 ${pid} 异常: ${result.error}`, 'error', this.taskId);
    }

    return result;
  }

  /**
   * 批量下载图片（优化版本，支持并发）
   */
  async batchDownload(pids: string[]): Promise<DownloadResult[]> {
    const results: DownloadResult[] = [];
    
    this.logManager.addLog(`开始批量下载 ${pids.length} 张图片（并发模式）`, 'info', this.taskId);
    
    // 分批处理，避免同时发起太多请求
    const batchSize = 3; // 并发数量
    const batches = [];
    
    for (let i = 0; i < pids.length; i += batchSize) {
      batches.push(pids.slice(i, i + batchSize));
    }
    
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      this.logManager.addLog(`处理第 ${batchIndex + 1}/${batches.length} 批，共 ${batch.length} 张图片`, 'info', this.taskId);
      
      // 并发处理当前批次
      const batchPromises = batch.map(async (pid, index) => {
        const globalIndex = batchIndex * batchSize + index;
        this.logManager.addLog(`处理第 ${globalIndex + 1}/${pids.length} 张图片: ${pid}`, 'info', this.taskId);
        
        try {
          const result = await this.downloadIllust(pid);
          
          if (result.success) {
            this.logManager.addLog(`图片 ${pid} 下载成功`, 'success', this.taskId);
          } else {
            this.logManager.addLog(`图片 ${pid} 下载失败: ${result.error}`, 'error', this.taskId);
          }
          
          return result;
        } catch (error) {
          const errorResult: DownloadResult = {
            success: false,
            pid,
            error: error instanceof Error ? error.message : String(error)
          };
          this.logManager.addLog(`图片 ${pid} 处理异常: ${errorResult.error}`, 'error', this.taskId);
          return errorResult;
        }
      });
      
      // 等待当前批次完成
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // 批次间短暂延迟，避免请求过于密集
      if (batchIndex < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    this.logManager.addLog(`批量下载完成，成功: ${successCount}/${pids.length}`, 'success', this.taskId);
    
    return results;
  }

  /**
   * 根据文件扩展名获取Content-Type
   */
  private getContentType(extension: string): string {
    const contentTypeMap: Record<string, string> = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'bmp': 'image/bmp'
    };
    
    return contentTypeMap[extension.toLowerCase()] || 'application/octet-stream';
  }
} 