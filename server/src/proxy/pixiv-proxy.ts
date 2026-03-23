import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PixivHeaders, PixivIllustPagesResponse } from '../types';
import { TursoService } from '../db/turso';
import {
  buildB2PublicUrl,
  buildPixivB2Key,
  extractFileExtension,
  getB2BaseUrlFromEnv,
  matchPathsBySize,
  normalizeSize,
  parseImagePathValue
} from './storage-path';

interface ILogManager {
  addLog(message: string, type: 'info' | 'error' | 'warning' | 'success', taskId?: string): void;
}

export interface ProxyResult {
  success: boolean;
  imageBuffer?: Buffer;
  contentType?: string;
  imageUrl?: string;
  error?: string;
  fromCache?: boolean;
  b2Url?: string;
}

const SIZE_FALLBACK_CHAIN = ['original', 'regular', 'small', 'thumb_mini'];

export class PixivProxy {
  private headers: PixivHeaders;
  private httpClient: AxiosInstance;
  private s3Client: S3Client;
  private bucketName: string;
  private b2BaseUrl: string;
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

    this.httpClient = axios.create({
      timeout: 30000,
      headers: this.headers as any
    });

    this.bucketName = process.env.B2_BUCKET_NAME || '';
    this.b2BaseUrl = getB2BaseUrlFromEnv();

    let endpoint = process.env.B2_ENDPOINT || '';
    if (endpoint && !endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
      endpoint = `https://${endpoint}`;
    }

    this.s3Client = new S3Client({
      endpoint,
      region: process.env.B2_REGION || 'us-east-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.B2_APPLICATION_KEY_ID || '',
        secretAccessKey: process.env.B2_APPLICATION_KEY || ''
      }
    });
  }

  async getIllustPages(pid: string): Promise<PixivIllustPagesResponse | null> {
    try {
      this.logManager.addLog(`Fetch pages for pid=${pid}`, 'info', this.taskId);
      const response = await this.httpClient.get(
        `https://www.pixiv.net/ajax/illust/${pid}/pages?lang=zh`
      );
      const payload: PixivIllustPagesResponse = response.data;
      if (payload.error === false && payload.body && payload.body.length > 0) {
        return payload;
      }
      this.logManager.addLog(`No page payload for pid=${pid}`, 'warning', this.taskId);
      return null;
    } catch (error) {
      this.logManager.addLog(
        `Fetch pages failed for pid=${pid}: ${error instanceof Error ? error.message : String(error)}`,
        'error',
        this.taskId
      );
      return null;
    }
  }

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

  private async checkDatabaseCache(pid: string, size: string): Promise<string | null> {
    const pic = await this.turso.getPicByPid(pid);
    if (!pic || !pic.image_path) {
      return null;
    }

    const allPaths = parseImagePathValue(pic.image_path);
    if (allPaths.length === 0) {
      return null;
    }

    const sizeMatched = matchPathsBySize(allPaths, size);
    const candidates = sizeMatched.length > 0 ? sizeMatched : allPaths;

    for (const key of candidates) {
      if (await this.existsInB2(key)) {
        return buildB2PublicUrl(this.b2BaseUrl, key);
      }
    }

    return null;
  }

  async checkB2Cache(pid: string, size: string = 'original'): Promise<string | null> {
    try {
      const normalizedSize = normalizeSize(size);

      const dbCacheHit = await this.checkDatabaseCache(pid, normalizedSize);
      if (dbCacheHit) {
        this.logManager.addLog(`B2 cache hit by DB path: pid=${pid} size=${normalizedSize}`, 'success', this.taskId);
        return dbCacheHit;
      }

      const extensions = ['jpg', 'png', 'gif', 'webp'];
      for (const ext of extensions) {
        const b2Key = buildPixivB2Key(pid, normalizedSize, ext);
        if (await this.existsInB2(b2Key)) {
          const b2Url = buildB2PublicUrl(this.b2BaseUrl, b2Key);
          this.logManager.addLog(`B2 cache hit by deterministic key: ${b2Key}`, 'success', this.taskId);
          return b2Url;
        }
      }

      return null;
    } catch (error) {
      this.logManager.addLog(
        `checkB2Cache failed: ${error instanceof Error ? error.message : String(error)}`,
        'warning',
        this.taskId
      );
      return null;
    }
  }

  async proxyImage(pid: string, targetSize?: string): Promise<ProxyResult> {
    try {
      const size = normalizeSize(targetSize);
      this.logManager.addLog(`Proxy request: pid=${pid} size=${size}`, 'info', this.taskId);

      const b2Url = await this.checkB2Cache(pid, size);
      if (b2Url) {
        return {
          success: true,
          fromCache: true,
          b2Url
        };
      }

      return await this.fetchFromPixiv(pid, size);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logManager.addLog(`Proxy request failed for pid=${pid}: ${message}`, 'error', this.taskId);
      return { success: false, error: message };
    }
  }

  async fetchFromPixiv(pid: string, targetSize?: string): Promise<ProxyResult> {
    const pagesResponse = await this.getIllustPages(pid);
    if (!pagesResponse || pagesResponse.body.length === 0) {
      return { success: false, error: 'No page data found from Pixiv' };
    }

    const preferredSize = normalizeSize(targetSize);
    const sizesToTry = [preferredSize, ...SIZE_FALLBACK_CHAIN.filter(size => size !== preferredSize)];

    for (const size of sizesToTry) {
      const urls = pagesResponse.body[0].urls;
      const imageUrl = urls[size as keyof typeof urls];
      if (!imageUrl) {
        continue;
      }

      this.logManager.addLog(`Fetch from Pixiv url size=${size}`, 'info', this.taskId);
      const result = await this.downloadImage(imageUrl, size);
      if (result.success) {
        return {
          ...result,
          imageUrl
        };
      }
    }

    return { success: false, error: 'All available sizes failed to fetch from Pixiv' };
  }

  private async downloadImage(imageUrl: string, size: string): Promise<ProxyResult> {
    try {
      const response: AxiosResponse<Buffer> = await this.httpClient.get(imageUrl, {
        responseType: 'arraybuffer',
        headers: {
          ...this.headers,
          Referer: 'https://www.pixiv.net/'
        }
      });

      if (response.status !== 200) {
        return { success: false, error: `Unexpected status=${response.status}` };
      }

      const imageBuffer = Buffer.from(response.data);
      const extension = extractFileExtension(imageUrl, 'jpg');
      const contentType = this.getContentType(extension);

      this.logManager.addLog(
        `Downloaded size=${size}, bytes=${imageBuffer.length}`,
        'success',
        this.taskId
      );

      return {
        success: true,
        imageBuffer,
        contentType,
        fromCache: false
      };
    } catch (error) {
      this.logManager.addLog(
        `Download failed for size=${size}: ${error instanceof Error ? error.message : String(error)}`,
        'warning',
        this.taskId
      );
      return { success: false, error: `Download failed for size=${size}` };
    }
  }

  private getContentType(extension: string): string {
    const contentTypeMap: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      bmp: 'image/bmp'
    };
    return contentTypeMap[extension.toLowerCase()] || 'application/octet-stream';
  }
}

