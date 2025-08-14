import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { 
  PixivHeaders, 
  PixivIllustPagesResponse, 
  PixivIllustInfo
} from '../types';

// 日志管理器接口
interface ILogManager {
  addLog(message: string, type: 'info' | 'error' | 'warning' | 'success', taskId?: string): void;
}

export class PixivProxy {
  private headers: PixivHeaders;
  private httpClient: AxiosInstance;
  private logManager: ILogManager;
  private taskId: string;

  constructor(
    headers: PixivHeaders, 
    logManager: ILogManager, 
    taskId: string
  ) {
    this.headers = headers;
    this.logManager = logManager;
    this.taskId = taskId;

    // 初始化HTTP客户端
    this.httpClient = axios.create({
      timeout: 15000, // 15秒超时
      headers: this.headers as any
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
      // 使用新的API方法获取插画信息，更加高效
      const response = await this.httpClient.get(
        `https://www.pixiv.net/ajax/illust/${pid}`
      );

      const resJson: PixivIllustInfo = response.data;
      
      if (resJson.error === false && resJson.body && resJson.body.userName) {
        const userName = resJson.body.userName;
        this.logManager.addLog(`获取到画师名字: ${userName}`, 'info', this.taskId);
        return userName;
      }
      
      this.logManager.addLog(`未找到插画 ${pid} 的画师名字`, 'warning', this.taskId);
      return null;
    } catch (error) {
      this.logManager.addLog(`获取画师名字异常: ${error instanceof Error ? error.message : String(error)}`, 'error', this.taskId);
      return null;
    }
  }

  /**
   * 代理访问图片
   */
  async proxyImage(pid: string, targetSize?: string): Promise<{ success: boolean; imageBuffer?: Buffer; contentType?: string; error?: string }> {
    try {
      this.logManager.addLog(`开始代理访问插画 ${pid}${targetSize ? `，目标尺寸: ${targetSize}` : ''}`, 'info', this.taskId);

      // 获取插画页面信息
      const pagesResponse = await this.getIllustPages(pid);
      if (!pagesResponse || pagesResponse.body.length === 0) {
        return { success: false, error: '未找到插画页面信息' };
      }

      // 获取画师名字（用于日志）
      await this.getArtistName(pid);

      // 如果指定了目标尺寸，优先尝试该尺寸
      if (targetSize) {
        const urls = pagesResponse.body[0].urls;
        const imageUrl = urls[targetSize as keyof typeof urls];
        
        if (imageUrl) {
          this.logManager.addLog(`尝试访问指定尺寸 ${targetSize}: ${imageUrl}`, 'info', this.taskId);
          const result = await this.tryDownloadImage(imageUrl, targetSize);
          if (result.success) {
            return result;
          }
          this.logManager.addLog(`指定尺寸 ${targetSize} 访问失败，尝试其他尺寸`, 'warning', this.taskId);
        } else {
          this.logManager.addLog(`指定尺寸 ${targetSize} 不存在，尝试其他尺寸`, 'warning', this.taskId);
        }
      }

      // 图片尺寸优先级 - 代理访问优先使用最小尺寸
      const imgSizes = ['thumb_mini', 'small', 'regular', 'original'];
      
      this.logManager.addLog(`开始代理访问插画 ${pid}，按优先级尝试尺寸: ${imgSizes.join(' → ')}`, 'info', this.taskId);
      
      for (const size of imgSizes) {
        const urls = pagesResponse.body[0].urls;
        const imageUrl = urls[size as keyof typeof urls];
        if (!imageUrl) {
          this.logManager.addLog(`插画 ${pid} 的 ${size} 尺寸图片链接不存在，跳过`, 'warning', this.taskId);
          continue;
        }

        this.logManager.addLog(`开始代理访问 ${pid} 的 ${size} 尺寸图片: ${imageUrl}`, 'info', this.taskId);

        const result = await this.tryDownloadImage(imageUrl, size);
        if (result.success) {
          return result;
        }
      }

      return { success: false, error: '所有尺寸的图片都无法访问' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logManager.addLog(`代理访问插画 ${pid} 异常: ${errorMessage}`, 'error', this.taskId);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * 尝试下载指定URL的图片
   */
  private async tryDownloadImage(imageUrl: string, size: string): Promise<{ success: boolean; imageBuffer?: Buffer; contentType?: string; error?: string }> {
    try {
      // 代理访问图片
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
        
        this.logManager.addLog(`代理访问成功，尺寸: ${size}，文件大小: ${fileSizeMB.toFixed(2)}MB`, 'success', this.taskId);
        
        // 获取文件扩展名和Content-Type
        const urlParts = imageUrl.split('.');
        const extension = urlParts[urlParts.length - 1].split('?')[0];
        const contentType = this.getContentType(extension);
        
        return {
          success: true,
          imageBuffer,
          contentType
        };
      }
    } catch (error) {
      this.logManager.addLog(`代理访问 ${size} 尺寸失败: ${error instanceof Error ? error.message : String(error)}`, 'warning', this.taskId);
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