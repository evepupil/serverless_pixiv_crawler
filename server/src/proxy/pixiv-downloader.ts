import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { PixivProxy } from './pixiv-proxy';
import { TursoService } from '../db/turso';
import { PixivHeaders } from '../types';

// 日志管理器接口
interface ILogManager {
  addLog(message: string, type: 'info' | 'error' | 'warning' | 'success', taskId?: string): void;
}

// 下载结果接口
export interface DownloadResult {
  success: boolean;
  pid: string;
  b2Path?: string;
  b2Url?: string;
  fileSize?: number;
  error?: string;
}

/**
 * Pixiv 图片下载器
 * 功能：从Pixiv下载图片并上传到B2存储
 */
export class PixivDownloader {
  private s3Client: S3Client;
  private bucketName: string;
  private proxy: PixivProxy;
  private turso: TursoService;
  private logManager: ILogManager;
  private taskId: string;

  constructor(
    headers: PixivHeaders,
    logManager: ILogManager,
    taskId: string,
    tursoService?: TursoService
  ) {
    this.logManager = logManager;
    this.taskId = taskId;
    this.turso = tursoService || new TursoService();
    this.proxy = new PixivProxy(headers, logManager, taskId, this.turso);

    // 初始化B2 S3客户端
    this.bucketName = process.env.B2_BUCKET_NAME || '';

    // 确保 endpoint 有 https:// 前缀
    let endpoint = process.env.B2_ENDPOINT || '';
    if (endpoint && !endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
      endpoint = `https://${endpoint}`;
    }

    this.s3Client = new S3Client({
      endpoint,
      region: process.env.B2_REGION || 'us-east-1',
      forcePathStyle: true,  // 使用 path-style URL: endpoint/bucket/key
      credentials: {
        accessKeyId: process.env.B2_APPLICATION_KEY_ID || '',
        secretAccessKey: process.env.B2_APPLICATION_KEY || ''
      }
    });
  }

  /**
   * 检查B2中是否已存在该文件
   */
  private async existsInB2(key: string): Promise<boolean> {
    try {
      await this.s3Client.send(new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: key
      }));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 上传图片到B2
   */
  private async uploadToB2(
    buffer: Buffer,
    key: string,
    contentType: string
  ): Promise<boolean> {
    try {
      await this.s3Client.send(new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: buffer,
        ContentType: contentType
      }));
      this.logManager.addLog(`上传到B2成功: ${key}`, 'success', this.taskId);
      return true;
    } catch (error) {
      this.logManager.addLog(`上传到B2失败: ${error instanceof Error ? error.message : String(error)}`, 'error', this.taskId);
      return false;
    }
  }

  /**
   * 下载并归档图片到B2
   */
  async downloadAndArchive(pid: string, targetSize: string = 'original'): Promise<DownloadResult> {
    try {
      this.logManager.addLog(`开始下载并归档 ${pid}`, 'info', this.taskId);

      // 1. 获取画师信息用于构建路径
      const artistInfo = await this.proxy.getArtistInfo(pid);
      const artistName = artistInfo?.userName || 'unknown';
      const artistId = artistInfo?.userId || 'unknown';

      // 2. 构建B2存储路径: pixiv/{artist_id}_{artist_name}/{pid}.{ext}
      const safeArtistName = artistName.replace(/[<>:"/\\|?*]/g, '_').substring(0, 50);

      // 3. 从Pixiv获取图片
      const proxyResult = await this.proxy.fetchFromPixiv(pid, targetSize);
      if (!proxyResult.success || !proxyResult.imageBuffer) {
        return { success: false, pid, error: proxyResult.error || '获取图片失败' };
      }

      // 4. 确定文件扩展名
      const imageUrl = proxyResult.imageUrl || '';
      const extension = imageUrl.split('.').pop()?.split('?')[0] || 'jpg';

      // 5. 构建完整路径（包含尺寸）: pixiv/{artist_id}_{artist_name}/{pid}/{size}.{ext}
      const b2Key = `pixiv/${artistId}_${safeArtistName}/${pid}/${targetSize}.${extension}`;

      // 6. 检查是否已存在
      if (await this.existsInB2(b2Key)) {
        this.logManager.addLog(`B2中已存在: ${b2Key}`, 'info', this.taskId);
        // 优先使用 B2_BUCKET_URL（Worker代理地址）
        let b2BaseUrl = process.env.B2_BUCKET_URL || process.env.B2_PUBLIC_URL || process.env.B2_ENDPOINT || '';
        b2BaseUrl = b2BaseUrl.replace(/\/+$/, '');
        const b2Url = `${b2BaseUrl}/${b2Key}`;

        // 更新数据库
        await this.updateDatabase(pid, b2Key, imageUrl, proxyResult.imageBuffer.length);

        return {
          success: true,
          pid,
          b2Path: b2Key,
          b2Url,
          fileSize: proxyResult.imageBuffer.length
        };
      }

      // 7. 上传到B2
      const uploaded = await this.uploadToB2(
        proxyResult.imageBuffer,
        b2Key,
        proxyResult.contentType || 'image/jpeg'
      );

      if (!uploaded) {
        return { success: false, pid, error: '上传到B2失败' };
      }

      // 8. 更新数据库
      await this.updateDatabase(pid, b2Key, imageUrl, proxyResult.imageBuffer.length);

      // 优先使用 B2_BUCKET_URL（Worker代理地址）
      let b2BaseUrl = process.env.B2_BUCKET_URL || process.env.B2_PUBLIC_URL || process.env.B2_ENDPOINT || '';
      b2BaseUrl = b2BaseUrl.replace(/\/+$/, '');
      const b2Url = `${b2BaseUrl}/${b2Key}`;

      this.logManager.addLog(`归档完成: ${pid} -> ${b2Key}`, 'success', this.taskId);

      return {
        success: true,
        pid,
        b2Path: b2Key,
        b2Url,
        fileSize: proxyResult.imageBuffer.length
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logManager.addLog(`下载归档失败 ${pid}: ${errorMessage}`, 'error', this.taskId);
      return { success: false, pid, error: errorMessage };
    }
  }

  /**
   * 更新数据库中的图片路径
   */
  private async updateDatabase(pid: string, b2Path: string, imageUrl: string = '', fileSize?: number): Promise<void> {
    try {
      await this.turso.updatePicDownload(pid, b2Path, imageUrl, fileSize);
      this.logManager.addLog(`数据库更新成功: ${pid}`, 'info', this.taskId);
    } catch (error) {
      this.logManager.addLog(`数据库更新失败: ${error instanceof Error ? error.message : String(error)}`, 'warning', this.taskId);
    }
  }

  /**
   * 批量下载并归档
   */
  async batchDownloadAndArchive(pids: string[], targetSize: string = 'original'): Promise<DownloadResult[]> {
    const results: DownloadResult[] = [];

    for (const pid of pids) {
      const result = await this.downloadAndArchive(pid, targetSize);
      results.push(result);

      // 添加延迟避免请求过快
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    const successCount = results.filter(r => r.success).length;
    this.logManager.addLog(`批量归档完成: ${successCount}/${pids.length} 成功`, 'success', this.taskId);

    return results;
  }
}
