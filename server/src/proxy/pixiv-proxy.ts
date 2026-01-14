import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { PixivHeaders, PixivIllustPagesResponse, PixivIllustInfo } from '../types';
import { TursoService } from '../db/turso';

// 日志管理器接口
interface ILogManager {
  addLog(message: string, type: 'info' | 'error' | 'warning' | 'success', taskId?: string): void;
}

// 代理结果接口
export interface ProxyResult {
  success: boolean;
  imageBuffer?: Buffer;
  contentType?: string;
  imageUrl?: string;
  error?: string;
  fromCache?: boolean;  // 是否来自B2缓存
  b2Url?: string;       // B2存储URL（用于重定向）
}

/**
 * Pixiv 图片代理服务
 * 功能：智能反代与自愈逻辑
 * 1. 检查 B2 存储中是否存在
 * 2. 若存在则返回 B2 链接（用于重定向）
 * 3. 若不存在，则伪造 Referer 抓取 Pixiv 原图并返回
 */
export class PixivProxy {
  private headers: PixivHeaders;
  private httpClient: AxiosInstance;
  private s3Client: S3Client;
  private bucketName: string;
  private logManager: ILogManager;
  private taskId: string;
  private turso: TursoService;

  constructor(
    headers: PixivHeaders,
    logManager: ILogManager,
    taskId: string,
    tursoService?: TursoService
  ) {
    this.headers = headers;
    this.logManager = logManager;
    this.taskId = taskId;
    this.turso = tursoService || new TursoService();

    // 初始化HTTP客户端
    this.httpClient = axios.create({
      timeout: 30000,
      headers: this.headers as any
    });

    // 初始化B2 S3客户端
    this.bucketName = process.env.B2_BUCKET_NAME || '';
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
   * 获取插画页面信息（获取图片URL）
   */
  async getIllustPages(pid: string): Promise<PixivIllustPagesResponse | null> {
    try {
      this.logManager.addLog(`获取插画 ${pid} 页面信息`, 'info', this.taskId);

      const response = await this.httpClient.get(
        `https://www.pixiv.net/ajax/illust/${pid}/pages?lang=zh`
      );

      const resJson: PixivIllustPagesResponse = response.data;

      if (resJson.error === false && resJson.body && resJson.body.length > 0) {
        this.logManager.addLog(`获取插画 ${pid} 页面信息成功，共 ${resJson.body.length} 张图片`, 'info', this.taskId);
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
   * 获取画师信息
   */
  async getArtistInfo(pid: string): Promise<{ userId: string; userName: string } | null> {
    try {
      const response = await this.httpClient.get(
        `https://www.pixiv.net/ajax/illust/${pid}`
      );

      const resJson: PixivIllustInfo = response.data;

      if (resJson.error === false && resJson.body) {
        return {
          userId: resJson.body.userId,
          userName: resJson.body.userName
        };
      }
      return null;
    } catch (error) {
      this.logManager.addLog(`获取画师信息异常: ${error instanceof Error ? error.message : String(error)}`, 'error', this.taskId);
      return null;
    }
  }

  /**
   * 检查B2中指定路径是否存在
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
   * 检查B2存储中是否存在该图片（支持分尺寸）
   */
  async checkB2Cache(pid: string, size: string = 'original'): Promise<string | null> {
    try {
      // 获取画师信息构建路径
      const artistInfo = await this.getArtistInfo(pid);
      if (!artistInfo) return null;

      const safeArtistName = artistInfo.userName.replace(/[<>:"/\\|?*]/g, '_').substring(0, 50);

      // 尝试常见扩展名
      const extensions = ['jpg', 'png', 'gif', 'webp'];
      for (const ext of extensions) {
        const b2Key = `pixiv/${artistInfo.userId}_${safeArtistName}/${pid}/${size}.${ext}`;
        if (await this.existsInB2(b2Key)) {
          let b2BaseUrl = process.env.B2_PUBLIC_URL || process.env.B2_ENDPOINT || '';
          if (b2BaseUrl && !b2BaseUrl.startsWith('http')) {
            b2BaseUrl = `https://${b2BaseUrl}`;
          }
          const b2Url = `${b2BaseUrl}/${b2Key}`;
          this.logManager.addLog(`B2缓存命中: ${pid}/${size} -> ${b2Url}`, 'success', this.taskId);
          return b2Url;
        }
      }
      return null;
    } catch (error) {
      this.logManager.addLog(`检查B2缓存异常: ${error instanceof Error ? error.message : String(error)}`, 'warning', this.taskId);
      return null;
    }
  }

  /**
   * 代理访问图片（智能模式）
   * 1. 先检查B2缓存
   * 2. 若有缓存返回B2 URL
   * 3. 若无缓存则从Pixiv抓取
   */
  async proxyImage(pid: string, targetSize?: string): Promise<ProxyResult> {
    try {
      this.logManager.addLog(`开始代理访问插画 ${pid}${targetSize ? `，目标尺寸: ${targetSize}` : ''}`, 'info', this.taskId);

      // 1. 检查B2缓存（按尺寸）
      const size = targetSize || 'original';
      const b2Url = await this.checkB2Cache(pid, size);
      if (b2Url) {
        return {
          success: true,
          fromCache: true,
          b2Url
        };
      }

      // 2. 从Pixiv获取图片
      return await this.fetchFromPixiv(pid, targetSize);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logManager.addLog(`代理访问插画 ${pid} 异常: ${errorMessage}`, 'error', this.taskId);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * 从Pixiv抓取图片
   */
  async fetchFromPixiv(pid: string, targetSize?: string): Promise<ProxyResult> {
    // 获取插画页面信息
    const pagesResponse = await this.getIllustPages(pid);
    if (!pagesResponse || pagesResponse.body.length === 0) {
      return { success: false, error: '未找到插画页面信息' };
    }

    // 图片尺寸优先级
    const defaultSizes = ['original', 'regular', 'small', 'thumb_mini'];
    const sizesToTry = targetSize ? [targetSize, ...defaultSizes.filter(s => s !== targetSize)] : defaultSizes;

    for (const size of sizesToTry) {
      const urls = pagesResponse.body[0].urls;
      const imageUrl = urls[size as keyof typeof urls];
      if (!imageUrl) continue;

      this.logManager.addLog(`尝试获取 ${pid} 的 ${size} 尺寸: ${imageUrl}`, 'info', this.taskId);

      const result = await this.downloadImage(imageUrl, size);
      if (result.success) {
        result.imageUrl = imageUrl;
        return result;
      }
    }

    return { success: false, error: '所有尺寸的图片都无法访问' };
  }

  /**
   * 下载指定URL的图片
   */
  private async downloadImage(imageUrl: string, size: string): Promise<ProxyResult> {
    try {
      const response: AxiosResponse<Buffer> = await this.httpClient.get(imageUrl, {
        responseType: 'arraybuffer',
        headers: {
          ...this.headers,
          'Referer': 'https://www.pixiv.net/'
        }
      });

      if (response.status === 200) {
        const imageBuffer = Buffer.from(response.data);
        const fileSizeMB = imageBuffer.length / (1024 * 1024);

        this.logManager.addLog(`下载成功，尺寸: ${size}，文件大小: ${fileSizeMB.toFixed(2)}MB`, 'success', this.taskId);

        const extension = imageUrl.split('.').pop()?.split('?')[0] || 'jpg';
        const contentType = this.getContentType(extension);

        return {
          success: true,
          imageBuffer,
          contentType,
          fromCache: false
        };
      }
    } catch (error) {
      this.logManager.addLog(`下载 ${size} 尺寸失败: ${error instanceof Error ? error.message : String(error)}`, 'warning', this.taskId);
    }

    return { success: false, error: `尺寸 ${size} 访问失败` };
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
