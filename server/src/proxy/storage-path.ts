const SUPPORTED_SIZES = ['original', 'regular', 'small', 'thumb_mini'] as const;

export type PixivImageSize = (typeof SUPPORTED_SIZES)[number];

export function normalizeSize(size?: string): PixivImageSize {
  if (!size) {
    return 'original';
  }
  const normalized = size.trim().toLowerCase();
  if ((SUPPORTED_SIZES as readonly string[]).includes(normalized)) {
    return normalized as PixivImageSize;
  }
  return 'original';
}

export function parseSizeList(
  input?: string | string[] | null,
  fallback: PixivImageSize[] = ['original']
): PixivImageSize[] {
  const rawValues = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(',')
      : [];

  const normalized = rawValues
    .map((item) => String(item).trim().toLowerCase())
    .filter((item): item is PixivImageSize =>
      (SUPPORTED_SIZES as readonly string[]).includes(item)
    );

  const unique = Array.from(new Set(normalized));
  return unique.length > 0 ? unique : [...fallback];
}

export function getB2BaseUrlFromEnv(): string {
  const rawBaseUrl =
    process.env.B2_BUCKET_URL ||
    process.env.B2_PUBLIC_URL ||
    process.env.B2_ENDPOINT ||
    '';

  if (!rawBaseUrl) {
    return '';
  }

  const withProtocol = rawBaseUrl.startsWith('http://') || rawBaseUrl.startsWith('https://')
    ? rawBaseUrl
    : `https://${rawBaseUrl}`;

  return withProtocol.replace(/\/+$/, '');
}

export function buildB2PublicUrl(baseUrl: string, key: string): string {
  if (!baseUrl) {
    return key;
  }
  const normalizedKey = key.replace(/^\/+/, '');
  return `${baseUrl}/${normalizedKey}`;
}

export function extractFileExtension(imageUrl: string, fallback: string = 'jpg'): string {
  if (!imageUrl) {
    return fallback;
  }

  const lastSegment = imageUrl.split('/').pop() || '';
  const fileName = lastSegment.split('?')[0];
  const extension = fileName.includes('.') ? fileName.split('.').pop() : '';
  if (!extension) {
    return fallback;
  }
  return extension.toLowerCase();
}

export function buildPixivB2Key(pid: string, size: string, extension: string): string {
  const normalizedSize = normalizeSize(size);
  const cleanExtension = (extension || 'jpg').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'jpg';
  return `pixiv/${pid}/${normalizedSize}.${cleanExtension}`;
}

export function parseImagePathValue(raw: string | null | undefined): string[] {
  if (!raw) {
    return [];
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed);

    if (Array.isArray(parsed)) {
      return parsed.map(item => String(item).trim()).filter(Boolean);
    }

    if (parsed && typeof parsed === 'object') {
      return Object.values(parsed)
        .map(item => String(item).trim())
        .filter(Boolean);
    }
  } catch {
    // Keep backward compatibility for old plain-string values.
  }

  return [trimmed];
}

export function matchPathsBySize(paths: string[], targetSize: string): string[] {
  const normalizedSize = normalizeSize(targetSize);
  return paths.filter(path => {
    const match = path.match(/(?:^|\/)(original|regular|small|thumb_mini)\.[a-zA-Z0-9]+$/);
    return match?.[1] === normalizedSize;
  });
}
