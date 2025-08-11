# Pixiv 爬虫服务 API 文档

## 概述

这是一个基于 Serverless 架构的 Pixiv 插画爬虫系统，提供了完整的 RESTful API 接口用于爬取、管理和监控 Pixiv 插画数据。

**基础URL**: `https://pixiv.chaosyn.com/api/`  
**本地开发**: `http://localhost:3000/`

## 认证

当前版本不需要认证，但需要正确配置以下环境变量：
- `SUPABASE_URL`: Supabase 数据库连接地址
- `SUPABASE_ANON_KEY`: Supabase 匿名访问密钥
- `PIXIV_COOKIE`: Pixiv 网站的有效 Cookie

## 通用响应格式

### 成功响应
```json
{
  "message": "操作成功",
  "data": {},
  "timestamp": "2025-01-11T06:00:00.000Z"
}
```

### 错误响应
```json
{
  "error": "错误描述",
  "message": "详细错误信息",
  "timestamp": "2025-01-11T06:00:00.000Z"
}
```

## API 端点

### 1. 获取 Web 界面

**端点**: `GET /`  
**描述**: 返回 Web 管理界面的 HTML 页面

**响应**:
- **Content-Type**: `text/html`
- **状态码**: `200`

**示例**:
```bash
curl -X GET "https://pixiv.chaosyn.com/api/"
```

---

### 2. 获取服务状态

**端点**: `GET /?action=status`  
**描述**: 获取服务运行状态和环境信息

**响应**:
```json
{
  "status": "running",
  "timestamp": "2025-01-11T06:00:00.000Z",
  "environment": "vercel",
  "nodeVersion": "v18.17.0",
  "platform": "linux",
  "envVarsCheck": {
    "supabaseUrl": true,
    "supabaseKey": true,
    "pixivCookie": true
  }
}
```

**示例**:
```bash
curl -X GET "https://pixiv.chaosyn.com/api/?action=status"
```

---

### 3. 获取统计信息

**端点**: `GET /?action=stats`  
**描述**: 获取数据库中的图片统计信息

**响应**:
```json
{
  "totalPics": 1250,
  "downloadedPics": 890,
  "avgPopularity": 0.67
}
```

**字段说明**:
- `totalPics`: 数据库中总图片数量
- `downloadedPics`: 已下载的图片数量
- `avgPopularity`: 平均热度值

**示例**:
```bash
curl -X GET "https://pixiv.chaosyn.com/api/?action=stats"
```

---

### 4. 环境变量检查

**端点**: `GET /?action=env-check`  
**描述**: 检查必要的环境变量是否配置正确

**响应**:
```json
{
  "valid": true,
  "timestamp": "2025-01-11T06:00:00.000Z"
}
```

**示例**:
```bash
curl -X GET "https://pixiv.chaosyn.com/api/?action=env-check"
```

---

### 5. 获取日志

**端点**: `GET /?action=logs`  
**描述**: 获取系统运行日志

**查询参数**:
- `taskId` (可选): 特定任务的ID，用于过滤日志
- `limit` (可选): 返回的日志条数，默认100，最大1000

**响应**:
```json
[
  {
    "id": "1754892188577abc123",
    "timestamp": "2025-01-11T06:00:00.000Z",
    "message": "开始爬取Pixiv插画，起始PID: 119603355",
    "type": "info",
    "taskId": "single_119603355_1754892188577"
  },
  {
    "id": "1754892189577def456",
    "timestamp": "2025-01-11T06:00:01.000Z",
    "message": "爬虫初始化完成，使用 1 个请求头",
    "type": "info",
    "taskId": "single_119603355_1754892188577"
  }
]
```

**日志类型**:
- `info`: 一般信息
- `success`: 成功操作
- `warning`: 警告信息
- `error`: 错误信息

**示例**:
```bash
# 获取所有日志
curl -X GET "https://pixiv.chaosyn.com/api/?action=logs&limit=50"

# 获取特定任务的日志
curl -X GET "https://pixiv.chaosyn.com/api/?action=logs&taskId=single_119603355_1754892188577"
```

---

### 6. 启动单个 PID 爬取任务

**端点**: `POST /`  
**描述**: 启动单个 Pixiv 插画 ID 的爬取任务

**请求体**:
```json
{
  "pid": "119603355",
  "targetNum": 10,
  "popularityThreshold": 0.22
}
```

**参数说明**:
- `pid` (必需): Pixiv 插画 ID
- `targetNum` (可选): 目标爬取数量，默认1000
- `popularityThreshold` (可选): 热度阈值 (0.01-1.0)，默认0.22

**响应**:
```json
{
  "message": "爬虫任务已启动",
  "pid": "119603355",
  "targetNum": 10,
  "popularityThreshold": 0.22,
  "taskId": "single_119603355_1754892188577",
  "timestamp": "2025-01-11T06:00:00.000Z"
}
```

**示例**:
```bash
curl -X POST "https://pixiv.chaosyn.com/api/" \
  -H "Content-Type: application/json" \
  -d '{
    "pid": "119603355",
    "targetNum": 10,
    "popularityThreshold": 0.22
  }'
```

---

### 7. 启动批量 PID 爬取任务

**端点**: `POST /`  
**描述**: 启动多个 Pixiv 插画 ID 的批量爬取任务

**请求体**:
```json
{
  "pids": ["119603355", "119603356", "119603357"],
  "targetNum": 10,
  "popularityThreshold": 0.22
}
```

**参数说明**:
- `pids` (必需): Pixiv 插画 ID 数组
- `targetNum` (可选): 每个PID的目标爬取数量，默认1000
- `popularityThreshold` (可选): 热度阈值 (0.01-1.0)，默认0.22

**响应**:
```json
{
  "message": "批量爬虫任务已启动",
  "pids": ["119603355", "119603356", "119603357"],
  "targetNum": 10,
  "popularityThreshold": 0.22,
  "count": 3,
  "taskId": "batch_1754892188577",
  "timestamp": "2025-01-11T06:00:00.000Z"
}
```

**示例**:
```bash
curl -X POST "https://pixiv.chaosyn.com/api/" \
  -H "Content-Type: application/json" \
  -d '{
    "pids": ["119603355", "119603356", "119603357"],
    "targetNum": 10,
    "popularityThreshold": 0.22
  }'
```

---

## 错误代码

| 状态码 | 描述 | 示例 |
|--------|------|------|
| 200 | 请求成功 | 正常响应 |
| 400 | 请求参数错误 | 缺少必要参数或参数格式错误 |
| 405 | 请求方法不允许 | 使用了不支持的HTTP方法 |
| 500 | 服务器内部错误 | 环境变量未配置或数据库连接失败 |

## 数据类型定义

### LogEntry (日志条目)
```typescript
interface LogEntry {
  id: string;                    // 日志唯一标识
  timestamp: string;             // ISO 8601 时间戳
  message: string;               // 日志消息
  type: 'info' | 'error' | 'warning' | 'success';  // 日志类型
  taskId?: string;               // 关联的任务ID
}
```

### DatabasePic (数据库图片记录)
```typescript
interface DatabasePic {
  pid: string;                   // Pixiv 插画 ID
  download_time: string;         // 下载时间
  tag: string;                   // 标签 (逗号分隔)
  good: number;                  // 点赞数
  star: number;                  // 收藏数
  view: number;                  // 浏览数
  image_path: string;            // 图片本地路径
  image_url: string;             // 图片URL
  popularity: number;            // 热度值 (0-1)
  upload_time?: string;          // 上传时间
  wx_url?: string;               // 微信图片URL
  wx_name?: string;              // 微信图片名称
  unfit?: boolean;               // 是否不适宜
}
```

## 使用流程

### 1. 基本爬取流程
```bash
# 1. 检查服务状态
curl -X GET "https://pixiv.chaosyn.com/api/?action=status"

# 2. 启动爬取任务
curl -X POST "https://pixiv.chaosyn.com/api/" \
  -H "Content-Type: application/json" \
  -d '{"pid": "119603355", "targetNum": 10}'

# 3. 监控任务进度 (使用返回的taskId)
curl -X GET "https://pixiv.chaosyn.com/api/?action=logs&taskId=single_119603355_1754892188577"

# 4. 查看统计信息
curl -X GET "https://pixiv.chaosyn.com/api/?action=stats"
```

### 2. 批量爬取流程
```bash
# 启动批量任务
curl -X POST "https://pixiv.chaosyn.com/api/" \
  -H "Content-Type: application/json" \
  -d '{
    "pids": ["119603355", "119603356", "119603357"],
    "targetNum": 5,
    "popularityThreshold": 0.3
  }'

# 监控批量任务
curl -X GET "https://pixiv.chaosyn.com/api/?action=logs&taskId=batch_1754892188577"
```

## 注意事项

1. **热度阈值**: 建议设置在 0.2-0.5 之间，过低会爬取大量低质量图片，过高可能爬取不到足够的图片
2. **目标数量**: 建议单次任务不超过 100 张，避免超时
3. **频率限制**: 系统内置了请求延迟机制，避免被 Pixiv 封禁
4. **日志保留**: 日志最多保存 1000 条，且只保留最近 1 小时的记录
5. **任务ID**: 每个任务都有唯一的 taskId，用于日志追踪和任务管理

## 环境配置

在使用 API 之前，请确保以下环境变量已正确配置：

```env
# Supabase 数据库配置
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key

# Pixiv Cookie (从浏览器获取)
PIXIV_COOKIE=your_pixiv_cookie_here
```

## 技术支持

如有问题，请查看：
1. 服务状态: `GET /?action=status`
2. 环境检查: `GET /?action=env-check`
3. 系统日志: `GET /?action=logs`

---

*最后更新: 2025-01-11*