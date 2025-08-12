# Pixiv 图片下载 API 文档

## 概述

本API提供了从Pixiv下载图片到Cloudflare R2存储的功能，并自动更新数据库中的图片信息。

## 环境变量配置

在使用下载功能前，需要配置以下环境变量：

```bash
# Cloudflare R2配置
CLOUDFLARE_ACCOUNT_ID=your_cloudflare_account_id
CLOUDFLARE_ACCESS_KEY_ID=your_cloudflare_access_key_id
CLOUDFLARE_SECRET_ACCESS_KEY=your_cloudflare_secret_access_key
CLOUDFLARE_BUCKET_NAME=your_cloudflare_bucket_name
CLOUDFLARE_REGION=auto

# 其他必需配置
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
PIXIV_COOKIE=your_pixiv_cookie
```

## API 端点

### 单个图片下载

**POST** `/api`

**请求体：**
```json
{
  "action": "download",
  "downloadPid": "123456789"
}
```

**响应：**
```json
{
  "message": "下载任务已启动",
  "pid": "123456789",
  "taskId": "download_single_123456789_1703123456789",
  "timestamp": "2023-12-21T10:30:56.789Z"
}
```

### 批量图片下载

**POST** `/api`

**请求体：**
```json
{
  "action": "download",
  "downloadPids": ["123456789", "987654321", "456789123"]
}
```

**响应：**
```json
{
  "message": "批量下载任务已启动",
  "pids": ["123456789", "987654321", "456789123"],
  "count": 3,
  "taskId": "download_batch_1703123456789",
  "timestamp": "2023-12-21T10:30:56.789Z"
}
```

## 功能特性

### 智能尺寸选择
- 按优先级尝试下载：original > regular > small > thumb_mini
- 自动跳过无法访问的尺寸

### 文件大小限制
- 限制单个文件最大为 **10MB**
- 超过限制的图片会自动跳过，尝试下一个尺寸

### 画师信息提取
- 自动从Pixiv页面提取画师名字
- 用于生成有意义的文件名：`@画师名 pid_123456.jpg`

### 重复检查
- 检查R2中是否已存在相同文件
- 避免重复上传，节省存储空间

### 数据库更新
- 更新 `pic` 表的 `image_url`（原始Pixiv URL）
- 更新 `download_time`（下载时间）
- **新增：更新 `size` 列（图片文件大小，单位：字节）**

### 错误处理
- 网络错误自动重试
- 详细的错误日志记录
- 部分失败不影响其他图片下载

## 错误处理

### 常见错误响应

```json
{
  "error": "下载任务启动失败",
  "message": "具体错误信息"
}
```

### 错误类型

1. **环境变量配置错误**
   - 缺少Cloudflare R2配置
   - 缺少Pixiv Cookie配置

2. **网络请求错误**
   - Pixiv API访问失败
   - R2上传失败

3. **数据解析错误**
   - 插画页面信息解析失败
   - 画师信息获取失败

## 使用示例

### cURL 示例

```bash
# 单个图片下载
curl -X POST https://your-domain.vercel.app/api \
  -H "Content-Type: application/json" \
  -d '{
    "action": "download",
    "downloadPid": "123456789"
  }'

# 批量图片下载
curl -X POST https://your-domain.vercel.app/api \
  -H "Content-Type: application/json" \
  -d '{
    "action": "download",
    "downloadPids": ["123456789", "987654321"]
  }'
```

### JavaScript 示例

```javascript
// 单个图片下载
const response = await fetch('/api', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'download',
    downloadPid: '123456789'
  })
});

// 批量图片下载
const response = await fetch('/api', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'download',
    downloadPids: ['123456789', '987654321', '456789123']
  })
});
```

## 监控和日志

### 任务状态查询

可以通过任务ID查询下载进度：

**GET** `/api?action=logs&taskId=download_single_123456789_1703123456789`

### 日志类型

- `info`: 一般信息
- `success`: 成功操作
- `warning`: 警告信息
- `error`: 错误信息

## 注意事项

1. **请求频率限制**
   - 建议在批量下载时添加适当延迟
   - 避免过于频繁的请求

2. **存储成本**
   - R2存储会产生费用
   - 建议定期清理不需要的文件

3. **版权问题**
   - 请遵守Pixiv的使用条款
   - 尊重画师的版权

4. **Cookie有效期**
   - Pixiv Cookie可能会过期
   - 需要定期更新Cookie

## 故障排除

### 常见问题

1. **下载失败**
   - 检查Pixiv Cookie是否有效
   - 确认插画ID是否正确
   - 检查网络连接

2. **上传失败**
   - 验证R2配置是否正确
   - 检查存储桶权限
   - 确认账户余额

3. **数据库更新失败**
   - 检查Supabase连接
   - 确认数据库权限
   - 验证表结构 