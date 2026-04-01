import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PixivProxy } from './pixiv-proxy';
import { TursoService } from '../db/turso';
import { PixivHeaders } from '../types';
import {
  buildB2PublicUrl,
  buildPixivB2Key,
  extractFileExtension,
  getB2BaseUrlFromEnv,
  normalizeSize
} from './storage-path';

interface ILogManager {
  addLog(message: string, type: 'info' | 'error' | 'warning' | 'success', taskId?: string): void;
}

export interface DownloadResult {
  success: boolean;
  pid: string;
  size: string;
  b2Path?: string;
  b2Url?: string;
  fileSize?: number;
  error?: string;
}

export class PixivDownloader {
  private static readonly DOWNLOAD_SIZE_FALLBACK_ORDER = ['original', 'regular', 'small', 'thumb_mini'] as const;

  private s3Client: S3Client;
  private bucketName: string;
  private b2BaseUrl: string;
  private proxy: PixivProxy;
  private turso: TursoService;
  private logManager: ILogManager;
  private taskId: string;
  private maxOriginalArchiveBytes: number;

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
    this.bucketName = process.env.B2_BUCKET_NAME || '';
    this.b2BaseUrl = getB2BaseUrlFromEnv();
    this.maxOriginalArchiveBytes = this.resolveMaxOriginalArchiveBytes();

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

  private resolveMaxOriginalArchiveBytes(): number {
    const rawMb = parseFloat(process.env.ARCHIVE_MAX_ORIGINAL_MB || '10');
    const safeMb = Number.isFinite(rawMb) && rawMb > 0 ? rawMb : 10;
    return Math.floor(safeMb * 1024 * 1024);
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

  private async uploadToB2(buffer: Buffer, key: string, contentType: string): Promise<boolean> {
    try {
      await this.s3Client.send(new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: buffer,
        ContentType: contentType
      }));
      this.logManager.addLog(`Uploaded to B2: ${key}`, 'success', this.taskId);
      return true;
    } catch (error) {
      this.logManager.addLog(
        `Upload to B2 failed: ${error instanceof Error ? error.message : String(error)}`,
        'error',
        this.taskId
      );
      return false;
    }
  }

  private async updateDatabase(pid: string, b2Path: string, imageUrl: string, fileSize?: number): Promise<void> {
    try {
      await this.turso.updatePicDownload(pid, b2Path, imageUrl, fileSize);
      this.logManager.addLog(`DB updated for pid=${pid}`, 'info', this.taskId);
    } catch (error) {
      this.logManager.addLog(
        `DB update failed for pid=${pid}: ${error instanceof Error ? error.message : String(error)}`,
        'warning',
        this.taskId
      );
    }
  }

  private normalizeSizes(sizes: string[]): string[] {
    const normalized = sizes
      .map(size => normalizeSize(size))
      .filter(Boolean);
    return Array.from(new Set(normalized));
  }

  private getDownloadFallbackSizes(requestedSize: string): string[] {
    const normalizedSize = normalizeSize(requestedSize);
    const startIndex = PixivDownloader.DOWNLOAD_SIZE_FALLBACK_ORDER.indexOf(normalizedSize);

    if (startIndex === -1) {
      return ['original', 'regular', 'small', 'thumb_mini'];
    }

    return [...PixivDownloader.DOWNLOAD_SIZE_FALLBACK_ORDER.slice(startIndex)];
  }

  private async archiveSingleSize(pid: string, size: string): Promise<DownloadResult> {
    const requestedSize = normalizeSize(size);
    const candidateSizes = this.getDownloadFallbackSizes(requestedSize);
    const errors: string[] = [];

    for (const candidateSize of candidateSizes) {
      const proxyResult = await this.proxy.fetchFromPixivExactSize(pid, candidateSize);
      if (!proxyResult.success || !proxyResult.imageBuffer) {
        errors.push(`${candidateSize}:${proxyResult.error || 'Fetch from Pixiv failed'}`);
        continue;
      }

      const fileSize = proxyResult.imageBuffer.length;
      if (requestedSize === 'original' && fileSize > this.maxOriginalArchiveBytes) {
        const limitMb = (this.maxOriginalArchiveBytes / 1024 / 1024).toFixed(2);
        this.logManager.addLog(
          `Archive downgrade pid=${pid}: ${candidateSize} is ${(fileSize / 1024 / 1024).toFixed(2)}MB > ${limitMb}MB`,
          'warning',
          this.taskId
        );
        errors.push(`${candidateSize}:exceeds_${limitMb}MB`);
        continue;
      }

      const imageUrl = proxyResult.imageUrl || '';
      const extension = extractFileExtension(imageUrl, 'jpg');
      const b2Key = buildPixivB2Key(pid, candidateSize, extension);

      if (await this.existsInB2(b2Key)) {
        await this.updateDatabase(pid, b2Key, imageUrl, fileSize);
        return {
          success: true,
          pid,
          size: candidateSize,
          b2Path: b2Key,
          b2Url: buildB2PublicUrl(this.b2BaseUrl, b2Key),
          fileSize
        };
      }

      const uploaded = await this.uploadToB2(
        proxyResult.imageBuffer,
        b2Key,
        proxyResult.contentType || 'image/jpeg'
      );

      if (!uploaded) {
        errors.push(`${candidateSize}:Upload to B2 failed`);
        continue;
      }

      await this.updateDatabase(pid, b2Key, imageUrl, fileSize);
      return {
        success: true,
        pid,
        size: candidateSize,
        b2Path: b2Key,
        b2Url: buildB2PublicUrl(this.b2BaseUrl, b2Key),
        fileSize
      };
    }

    return {
      success: false,
      pid,
      size: requestedSize,
      error: errors.length > 0 ? errors.join(' | ') : 'No downloadable size available'
    };
  }

  async downloadAndArchive(pid: string, targetSize: string = 'original'): Promise<DownloadResult> {
    this.logManager.addLog(`Archive start pid=${pid}, size=${targetSize}`, 'info', this.taskId);
    return this.archiveSingleSize(pid, targetSize);
  }

  async downloadAndArchiveMultiSizes(pid: string, targetSizes: string[]): Promise<DownloadResult[]> {
    const sizes = this.normalizeSizes(targetSizes);
    const safeSizes = sizes.length > 0 ? sizes : ['original'];
    const results: DownloadResult[] = [];

    for (const size of safeSizes) {
      const result = await this.archiveSingleSize(pid, size);
      results.push(result);
      await new Promise(resolve => setTimeout(resolve, 150));
    }

    const successCount = results.filter(item => item.success).length;
    this.logManager.addLog(
      `Archive done pid=${pid}: ${successCount}/${results.length}`,
      successCount === results.length ? 'success' : 'warning',
      this.taskId
    );

    return results;
  }

  async batchDownloadAndArchive(pids: string[], targetSize: string = 'original'): Promise<DownloadResult[]> {
    const results: DownloadResult[] = [];

    for (const pid of pids) {
      const result = await this.downloadAndArchive(pid, targetSize);
      results.push(result);
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    const successCount = results.filter(item => item.success).length;
    this.logManager.addLog(
      `Batch archive done: ${successCount}/${pids.length}`,
      'success',
      this.taskId
    );
    return results;
  }

  async batchDownloadAndArchiveMultiSizes(pids: string[], targetSizes: string[]): Promise<DownloadResult[]> {
    const results: DownloadResult[] = [];
    for (const pid of pids) {
      const perPidResults = await this.downloadAndArchiveMultiSizes(pid, targetSizes);
      results.push(...perPidResults);
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    const successCount = results.filter(item => item.success).length;
    this.logManager.addLog(
      `Batch multi-size archive done: ${successCount}/${results.length}`,
      'success',
      this.taskId
    );
    return results;
  }
}
