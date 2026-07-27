# Pixiv 爬虫东京服务器 · API 文档

> 对应代码:[`server/src/index.ts`](../src/index.ts)(HTTP 入口与路由)、[`server/src/db/turso.ts`](../src/db/turso.ts)(数据库)、[`server/src/scheduler/index.ts`](../src/scheduler/index.ts)(调度器)、[`server/src/db/schema.ts`](../src/db/schema.ts)(表结构)

## 1. 概述

东京服务器版爬虫,跑在东京 VPS 上(Turso/libSQL 数据库 + Backblaze B2 存储),针对低延迟场景优化。和 Vercel serverless 版相比,它内置调度器,能自己定时跑完整的「发现 → 补全 → 打分 → 分级下载 → 对账」管线,并把结果通过候选池接口喂给上游业务挑选。

| 项 | 值 |
|----|----|
| 监听端口 | `PORT`(默认 3000),绑 `0.0.0.0` |
| 入口 | 根路径 `/`,通过 `?action=`(GET)或 `body.action`(POST)区分 |
| 数据库 | Turso(libSQL,支持本地 `file:` 模式) |
| 对象存储 | Backblaze B2(S3 兼容) |
| 调度器 | 启动时自动起,定时 HTTP 自调用 `localhost:PORT` |
| 请求超时 | 调度器自调用 60s;Vercel 函数 maxDuration 60s 不适用本服务 |

## 2. 通用约定

### 2.1 鉴权

配置环境变量 `SERVER_API_KEY` 后,所有接口都需要在请求头里携带该值,两种写法任选:

```
X-API-Key: <你的key>
```

```
Authorization: Bearer <你的key>
```

未配置 `SERVER_API_KEY` 时不校验(启动日志会打 `WARNING: SERVER_API_KEY not set - HTTP API is unauthenticated!`),等同于裸奔,仅用于向后兼容。

校验失败返回 `401`:

```json
{ "error": "Unauthorized", "message": "Missing or invalid API key" }
```

校验用恒定时间比较(`crypto.timingSafeEqual`),防时序攻击。调度器自调用会自动带上 `X-API-Key` 头,无需额外配置。

### 2.2 请求格式

- **GET**:参数走 query string,如 `/?action=status&pid=12345`
- **POST**:参数走 JSON body,如 `{"action":"batch-tasks","pids":["1","2"]}`,需 `Content-Type: application/json`
- **OPTIONS**:CORS 预检,直接返回 200

### 2.3 响应格式

统一返回 JSON,带 CORS 头(`Access-Control-Allow-Origin: *`)。常见字段:

| 字段 | 说明 |
|------|------|
| `success` | 布尔,操作是否成功 |
| `timestamp` | ISO 8601 时间 |
| `taskId` | 异步任务标识,可用于追踪日志 |
| `error` / `message` | 错误或提示信息 |

异步任务(爬取、下载等)接口会**立即返回 `taskId`**,实际工作在后台跑,进度看服务控制台日志。

### 2.4 图片尺寸

四档,从小到大:

| 尺寸 | 用途 |
|------|------|
| `thumb_mini` | 缩略图,预览用 |
| `small` | 小图,预览用 |
| `regular` | 中等尺寸 |
| `original` | 原图 |

`download_stage` 字段:有 `original` 或 `regular` 算 `full`,只有 `thumb_mini`/`small` 算 `preview`,都没有算 `none`。

---

## 3. 接口

### 3.1 运维与状态

#### `GET /?action=status`

服务状态。

**响应**:
```json
{
  "status": "running",
  "timestamp": "2026-07-27T12:00:00.000Z",
  "environment": "tokyo-server",
  "nodeVersion": "v20.x",
  "platform": "linux",
  "database": "turso"
}
```

#### `GET /?action=stats`

统计信息(总数 / 已下载数 / 平均热度)。

**响应**:
```json
{ "totalPics": 12345, "downloadedPics": 6789, "avgPopularity": 0.0042 }
```

#### `GET /?action=env-check`

检查环境变量是否配置完整。

**响应**:
```json
{
  "valid": true,
  "missing": [],
  "b2Valid": true,
  "b2Missing": [],
  "timestamp": "..."
}
```

### 3.2 调度器控制

#### `GET /?action=scheduler-status`

查看调度器状态和已注册任务。

**响应**:
```json
{
  "success": true,
  "isRunning": true,
  "tasks": [
    { "name": "日榜爬取", "enabled": true, "interval": 86400000 }
  ],
  "timestamp": "..."
}
```

#### `GET /?action=scheduler-start`

启动调度器。**响应**:`{ "success": true, "message": "Scheduler started", ... }`

#### `GET /?action=scheduler-stop`

停止调度器。**响应**:`{ "success": true, "message": "Scheduler stopped", ... }`

#### `GET /?action=scheduler-trigger&task=<actionName>`

手动触发某个调度任务(立即执行一次,不影响定时)。`task` 是 action 名,如 `home`、`auto-topn-preview`、`run-full-download`。

**响应**:`{ "success": true, "message": "Triggered task: home", ... }`

### 3.3 数据查询

#### `GET /?action=get-pic&pid=<pid>`

查单个作品信息。

**响应**(找到):
```json
{ "success": true, "data": { "pid": "...", "title": "...", "author_id": "...", "tag": "...", "good": 0, "star": 0, "view": 0, "popularity": 0, "image_path": "...", "download_stage": "none", ... } }
```
未找到返回 `404`:`{ "success": false, "error": "PID not found" }`。

#### `GET /?action=exists&pid=<pid>`

检查 PID 是否已存在(高性能去重,走本地副本可达微秒级)。

**响应**:`{ "pid": "12345", "exists": true }`

#### `GET /?action=random-pids&count=<10>`

随机取 PID。`count` 范围 1-100。

**响应**:`{ "success": true, "pids": ["1","2",...], "count": 10, "timestamp": "..." }`

#### `GET /?action=uncompleted-tasks&type=<taskType>&limit=<100>`

取未完成的爬取任务 PID 列表,按优先级降序。

| 参数 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| `type` | string | 是 | - | `illust_recommend` / `author_recommend` / `detail_info` |
| `limit` | int | 否 | 100 | 最多返回多少条 |

**响应**:`{ "success": true, "taskType": "detail_info", "pids": [...], "count": 50, "timestamp": "..." }`

#### `GET /?action=watch-targets&enabledOnly=<bool>`

列出监控目标(标签 / 作者)。`enabledOnly=true` 只返回启用的。

**响应**:`{ "success": true, "count": 5, "items": [...], "timestamp": "..." }`

#### `GET|POST ?action=business-candidates`

业务候选池--给上游业务(每日精选、作者专题、主题合集等)挑图用。按候选评分排序,可随机采样到 `limit`。

| 参数 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| `pool` | string | 是 | - | `ranking` / `daily` / `artist` / `topic` / `avatar` / `wallpaper` |
| `limit` | int | 否 | 30 | 返回数量,范围 1-200 |
| `topN` | int | 否 | max(limit,200) | 先取 TopN 再采样,范围 limit-1000 |
| `excludePublished` | bool | 否 | true | 排除已发布过的(查 `daily_pick`/`artist_feature`/`topic_feature` 的 `is_published`) |
| `onlyDownloaded` | bool | 否 | true | 只返回已归档的 |
| `downloadStatus` | string | 否 | any | `any` / `preview` / `regular` / `original` |
| `artistId` | string | 否 | - | 按作者 ID 过滤 |
| `tags` | string[] | 否 | - | 按标签过滤(逗号分隔或数组) |

**响应**:
```json
{
  "success": true,
  "pool": "daily",
  "limit": 30,
  "topN": 200,
  "excludePublished": true,
  "onlyDownloaded": true,
  "downloadStatus": "any",
  "artistId": null,
  "tags": [],
  "count": 30,
  "items": [
    { "pid": "...", "priority": 1180, "candidateScore": 820.5, "sourceType": "ranking_daily", "downloadStage": "full", "popularity": 0.01, "view": 5000, ... }
  ],
  "timestamp": "..."
}
```

各候选池的来源规则:

| pool | 来源(source_type + 时间窗口 + biz_type) |
|------|------|
| `ranking` | ranking_daily(3天) / ranking_weekly(7天) / ranking_monthly(14天) |
| `daily` | ranking_daily(3天) / ranking_weekly(7天) / home(7天) / illust_recommend(7天) / author_recommend(14天) |
| `topic` | tag_watch(7天,biz_type=topic) |
| `avatar` | tag_watch(7天,biz_type=avatar) |
| `wallpaper` | tag_watch(7天,biz_type=wallpaper) |
| `artist` | artist_watch(14天,biz_type=artist) / manual(30天) |

### 3.4 采集与发现

#### `GET /?action=home`

拉 Pixiv 首页推荐 PID 入库(`pic_task`,source_type=`home`,priority=720)。**响应**:`{ "success": true, "message": "...", "count": 30, "pids": [...前20], "taskId": "...", "timestamp": "..." }`

#### `GET /?action=daily|weekly|monthly`

抓排行榜,入库 `ranking` 表 + 入队 `pic_task`(按名次算优先级:日榜 1200-名次、周榜 900-、月榜 700-)。

**响应**:`{ "success": true, "type": "daily", "count": 50, "rankDate": "2026-07-27", "taskId": "...", "timestamp": "..." }`

#### `GET /?action=illust-recommend-pids&pid=<pid>&targetNum=<30>`

取某作品的插画推荐 PID(扩关系网)。**响应**:`{ "success": true, "pid": "...", "targetNum": 30, "pids": [...], "count": 30, "taskId": "...", "timestamp": "..." }`

#### `GET /?action=author-recommend-pids&pid=<pid>&targetNum=<30>`

取某作品作者的推荐 PID。响应同上结构。

#### `GET /?action=tag-search-pids&tag=<tag>&targetNum=<60>`

按标签搜作品 PID。**响应**:`{ "success": true, "tag": "...", "targetNum": 60, "pids": [...], "count": 60, "taskId": "...", "timestamp": "..." }`

#### `GET /?action=artist-works-pids&artistId=<id>&targetNum=<60>`

取某作者全部作品 PID。响应同上结构(字段为 `artistId`)。

#### `GET /?action=pid-detail-info&pid=<pid>&threshold=<0>`

拉作品详情(点赞 / 收藏 / 浏览 / 标签 / 热度)并入库 `pic` 表,补全后自动刷新候选评分。

| 参数 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| `pid` | string | 是 | - | 作品 ID |
| `threshold` | float | 否 | 0 | 热度阈值(低于则跳过) |

**响应**:`{ "success": true, "pid": "...", "taskId": "...", "timestamp": "..." }`

#### `POST /` body: `{"action":"crawl-uncompleted","taskType":"<type>","limit":50,"threshold":0}`

批量处理未完成任务--取未完成 PID 逐个跑对应爬取(插画推荐 / 作者推荐 / 详情),失败有退避重试。

| 参数 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| `taskType` | string | 是 | - | `illust_recommend` / `author_recommend` / `detail_info` |
| `limit` | int | 否 | 50 | 处理数量 |
| `threshold` | float | 否 | 0 | 热度阈值 |

异步,立即返回:`{ "success": true, "message": "Start processing N tasks", "taskType": "...", "count": 50, "taskId": "...", "timestamp": "..." }`。无任务时返回 `No uncompleted tasks`。

#### `POST /` body: `{"action":"collect-watch-targets","limitTargets":10,"perTargetLimit":60,"targetIds":[...]}`

跑一遍监控目标采集--对每个启用的 `watch_target`,按标签或作者拉新作品 PID 入库。

| 参数 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| `limitTargets` | int | 否 | `WATCH_TARGET_RUN_LIMIT`(10) | 处理多少个监控目标,范围 1-100 |
| `perTargetLimit` | int | 否 | `WATCH_TARGET_PER_TARGET_LIMIT`(60) | 每个目标取多少 PID,范围 1-200 |
| `targetIds` | int[] | 否 | - | 只跑指定 ID 的目标(否则按优先级 + last_run_at 选) |

异步,立即返回,`targets` 字段列出本次要处理的目标。

### 3.5 下载与归档

下载走 `download_job` 任务队列,流程是:**查候选 → 入队(去重)→ 认领(claim)→ 下载到 B2 → 标记成功/失败**。三类 job:

| jobType | 尺寸 | 触发接口 |
|---------|------|----------|
| `preview` | thumb_mini / small | `auto-topn-preview` |
| `backfill` | thumb_mini / small | `run-backfill-preview` |
| `full` | regular / original | `enqueue-full-download` / `run-full-download` |

#### `POST /` body: `{"action":"auto-topn-preview","limit":120,"minPopularity":0,"sizes":["thumb_mini","small"],"dryRun":false}`

近期高分候选下预览图。按来源配额选取(日榜 35% / 周榜 15% / 首页 15% / 关系网 15% / 标签监控 12% / 作者监控 8%),配额在 `AUTO_PREVIEW_QUOTA_*` 环境变量调。

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `limit` | int | 120 | 范围 1-500 |
| `minPopularity` | float | 0 | 最低热度门槛 |
| `sizes` | string[] | `["thumb_mini","small"]` | 要下的尺寸 |
| `dryRun` | bool | false | 只看候选不入队、不下裁 |
| `rankingDailyDays` 等 | int | 见 env | 各来源的时间窗口(天) |
| `rankingDailyRatio` 等 | float | 见 env | 各来源的配额比 |

**响应**:
```json
{
  "success": true,
  "taskId": "auto_topn_preview_...",
  "dryRun": false,
  "sizes": ["thumb_mini","small"],
  "limit": 120,
  "minPopularity": 0,
  "windows": { "rankingDailyDays": 3, ... },
  "quotas": { "rankingDailyRatio": 0.35, ... },
  "candidateCount": 100,
  "enqueuedCount": 100,
  "claimedCount": 100,
  "candidatePreview": [
    { "pid": "...", "priority": 1180, "candidateScore": 820.5, "sourceType": "ranking_daily", "popularity": 0.01, "view": 5000 }
  ],
  "timestamp": "..."
}
```

#### `POST /` body: `{"action":"run-backfill-preview","limit":30,"minPopularity":0,"minAgeDays":30,"sizes":["thumb_mini","small"],"dryRun":false}`

给老作品(超过 `minAgeDays` 天没下过预览的)补预览图。参数同上,多了 `minAgeDays`(默认 30)。默认调度器禁用,需手动触发或开 `SCHEDULER_BACKFILL_PREVIEW_ENABLED`。

#### `POST /` body: `{"action":"enqueue-full-download","pids":["1","2"],"sizes":["regular","original"],"priority":900,"maxAttempts":3,"runNow":true,"runLimit":10,"sourceType":"manual","sourceKey":"xxx"}`

把指定 PID 入队全尺寸下载。

| 参数 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| `pids` | string[] | 是 | - | 要下载的 PID |
| `sizes` | string[] | 否 | `["regular","original"]` | 要下的尺寸 |
| `priority` | int | 否 | 900 | 范围 1-2000 |
| `maxAttempts` | int | 否 | 3 | 最大重试次数,1-10 |
| `runNow` | bool | 否 | false | 是否立即认领并跑一批 |
| `runLimit` | int | 否 | max(pids.length,1) | `runNow` 时认领多少,1-500 |
| `sourceType` / `sourceKey` | string | 否 | - | 来源标记 |

**响应**:`{ "success": true, "taskId": "...", "message": "Full download queued and worker started", "count": 2, "enqueuedCount": 2, "skippedCount": 0, "sizes": [...], "priority": 900, "runNow": true, "claimedCount": 2, "timestamp": "..." }`

#### `POST /` body: `{"action":"run-full-download","limit":30}`

认领一批 pending 的 full 下载任务跑掉。异步。**响应**:`{ "success": true, "taskId": "...", "limit": 30, "claimedCount": 30, "message": "...", "timestamp": "..." }`

#### `POST /` body: `{"action":"batch-download","pids":["1","2"],"sizes":["original"]}`

直接批量下载(不走 `download_job` 队列,适合一次性手动下)。异步。**响应**:`{ "success": true, "message": "Batch download task started", "taskId": "...", "count": 2, "sizes": [...], "timestamp": "..." }`

#### `GET /?action=proxy&pid=<pid>&size=<original>`

代理访问图片。命中 B2 缓存则 `302` 重定向到 B2 公开 URL;未命中则从 Pixiv 拉取返回(并异步归档到 B2,下次命中缓存)。

**响应**:命中缓存时 `302 Location: <b2_url>`;未命中时 `200` 返回图片二进制(`Content-Type` 为图片类型,缓存 1 天)。

### 3.6 配置与写入

#### `POST /` body: `{"action":"upsert-pic","pic":{"pid":"...","title":"...","good":100,...}}`

写入或更新单条 `pic` 记录(upsert,自动刷新候选评分)。`pic.pid` 必填。**响应**:`{ "success": true, "message": "Pic upsert success", "pid": "..." }`

#### `POST /` body: `{"action":"batch-tasks","pids":["1","2"],"priority":500,"sourceType":"manual","sourceKey":"xxx","sourceRecentAt":"2026-07-27 00:00:00"}`

批量创建 `pic_task`(同时 upsert `pic_source` 来源记录)。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `pids` | string[] | 是 | PID 列表 |
| `priority` | int | 否 | 优先级,取 max 已有值 |
| `sourceType` | string | 否 | 来源类型(见下) |
| `sourceKey` | string | 否 | 来源键(如 `tag:原神`、`daily:2026-07-27`) |
| `sourceRecentAt` | string | 否 | 发现时间 |

**响应**:`{ "success": true, "message": "Batch tasks created", "count": 2 }`

`sourceType` 取值:`home` / `ranking_daily` / `ranking_weekly` / `ranking_monthly` / `illust_recommend` / `author_recommend` / `tag_watch` / `artist_watch` / `manual`。

#### `POST /` body: `{"action":"update-task-status","pid":"...","taskType":"detail_info","count":0}`

标记某 PID 的某类爬取已完成。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `pid` | string | 是 | 作品 ID |
| `taskType` | string | 是 | `illust_recommend` / `author_recommend` / `detail_info` |
| `count` | int | 否 | 推荐数量(前两类用) |

**响应**:`{ "success": true, "message": "Task status updated", "pid": "...", "taskType": "..." }`

#### `POST /` body: `{"action":"batch-exists","pids":["1","2"]}`

批量检查 PID 是否已存在。**响应**:`{ "success": true, "existingPids": ["1"], "existingCount": 1, "totalChecked": 2 }`

#### `POST /` body: `{"action":"batch-detail-info","pids":["1","2"],"threshold":0}`

批量拉详情入库。异步。**响应**:`{ "success": true, "message": "Batch detail task started", "count": 2, "threshold": 0, "taskId": "...", "timestamp": "..." }`

#### `POST /` body: `{"action":"upsert-watch-target","targetType":"tag","targetValue":"原神","bizType":"topic","priority":500,"windowDays":7,"dailyPreviewQuota":50,"enabled":true,"meta":"..."}`

新增或更新监控目标。`targetType` 为 `tag` / `artist`,`targetValue` 必填。带 `id` 则更新,不带则新增(按 `target_type + target_value + biz_type` 唯一去重)。**响应**:`{ "success": true, "item": {...}, "timestamp": "..." }`

#### `POST /` body: `{"action":"delete-watch-target","id":1}`

删除监控目标。**响应**:`{ "success": true, "id": 1, "timestamp": "..." }`

#### `POST /` body: `{"action":"refresh-candidate-score","limit":200,"pids":["1","2"]}`

重算候选评分。不传 `pids` 则按 `last_seen_at` 倒序取最近 `limit` 条。**响应**:`{ "success": true, "limit": 200, "updatedCount": 200, "pidCount": 0, "timestamp": "..." }`

#### `POST /` body: `{"action":"reconcile-storage","limit":50,"pids":[...],"dryRun":false}`

存储状态对账--检查 `pic` 表的 `image_path` / `image_variants` / `download_stage` 是否一致,修正偏差。

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `limit` | int | `RECONCILE_STORAGE_DEFAULT_LIMIT`(50) | 范围 1-500 |
| `pids` | string[] | - | 只对账指定 PID(否则取最近有归档的) |
| `dryRun` | bool | false | 只看不改 |

异步,立即返回 `count` 和 `sample`(前 20 条预览)。默认调度器禁用。

---

## 4. 数据模型

6 张表,定义在 [`server/src/db/schema.ts`](../src/db/schema.ts)。

### `pic` -- 作品主表

| 字段 | 类型 | 说明 |
|------|------|------|
| `pid` | text PK | 作品 ID |
| `title` / `author_id` / `author_name` | text | 作品信息 |
| `tag` | text | 标签(JSON) |
| `good` / `star` / `view` | integer | 点赞 / 收藏 / 浏览 |
| `popularity` | real | 热度 = (good×0.55 + star×0.45) ÷ view |
| `image_path` | text | 归档路径(JSON 数组) |
| `image_url` | text | 原始 URL |
| `image_variants` | text | 各尺寸归档路径(JSON,如 `{"original":".../original.jpg"}`) |
| `download_stage` | text | `none` / `preview` / `full` |
| `preview_downloaded_at` / `full_downloaded_at` | text | 各阶段下载时间 |
| `candidate_score` | real | 候选评分(决定下载优先级) |
| `first_seen_at` / `last_seen_at` | text | 首次 / 最近发现时间 |
| `last_source_type` | text | 最近来源类型 |
| `unfit` | integer | 是否不合适(0/1) |
| `created_at` / `updated_at` | text | 时间戳 |

### `pic_task` -- 任务跟踪表

记录三类爬取(插画推荐 / 作者推荐 / 详情)是否完成,以及优先级、来源、重试状态。

| 字段 | 说明 |
|------|------|
| `pid` | text PK |
| `illust_recommend_crawled` / `author_recommend_crawled` / `detail_info_crawled` | 是否已完成 |
| `illust_recommend_count` / `author_recommend_count` | 推荐数量 |
| `priority` | 优先级(决定处理顺序) |
| `task_source_type` / `task_source_key` / `source_recent_at` | 任务来源 |
| `attempt_count` / `next_retry_at` / `last_error` | 重试状态 |

### `ranking` -- 排行榜表

| 字段 | 说明 |
|------|------|
| `id` | integer PK |
| `pid` / `rank` | 作品 ID / 名次 |
| `rank_type` | `daily` / `weekly` / `monthly` |
| `rank_date` / `crawl_time` | 日期 / 抓取时间 |
| 唯一索引 | `(rank_type, rank_date, pid)` |

### `pic_source` -- 来源流水表

一个 PID 可以有多个来源(从日榜来的、从标签监控来的等),候选池查询的基础。

| 字段 | 说明 |
|------|------|
| `id` | integer PK |
| `pid` / `source_type` / `source_key` | 作品 + 来源 |
| `biz_type` | 业务类型(`ranking` / `topic` / `avatar` / `wallpaper` / `artist` / `general`) |
| `rank_value` | 名次(排行榜来源) |
| `source_score` | 来源评分 |
| `discovered_at` | 发现时间 |
| 唯一索引 | `(pid, source_type, source_key)` |

### `watch_target` -- 监控目标表

| 字段 | 说明 |
|------|------|
| `id` | integer PK |
| `target_type` | `tag` / `artist` |
| `target_value` | 标签名或作者 ID |
| `biz_type` | 业务类型(默认 `general`) |
| `priority` | 优先级(默认 500) |
| `window_days` | 时间窗口(默认 7) |
| `daily_preview_quota` | 每日预览配额(默认 50) |
| `enabled` | 是否启用(0/1) |
| `last_run_at` | 上次运行时间 |
| 唯一索引 | `(target_type, target_value, biz_type)` |

### `download_job` -- 下载任务队列

| 字段 | 说明 |
|------|------|
| `id` | integer PK |
| `pid` / `job_type` | 作品 + `preview` / `backfill` / `full` |
| `requested_sizes` | 要下的尺寸(JSON 数组) |
| `status` | `pending` / `running` / `success` / `failed` |
| `priority` | 优先级 |
| `source_type` / `source_key` | 来源 |
| `max_attempts` / `attempt_count` | 最大重试 / 已尝试次数 |
| `last_error` / `started_at` / `finished_at` | 状态 |

### 候选评分公式

`candidate_score` 决定下载优先级,在 [`turso.ts`](../src/db/turso.ts) 的 `buildCalculatedCandidateScoreExpression` 里算:

```
candidate_score =
  MIN(popularity, 1.5) × 520          // 热度,封顶 1.5
+ MIN(view, 20000)/20000 × 140        // 浏览量,封顶 2 万
+ MIN(star, 12000)/12000 × 120        // 收藏,封顶 1.2 万
+ MIN(good, 12000)/12000 × 60         // 点赞,封顶 1.2 万
+ 新鲜度加分                            // 1 天内 220 → 3 天 180 → 7 天 130 → 14 天 90 → 30 天 50 → 更久 15
+ 来源权重                             // ranking_daily 160 / tag_watch 110 / home 100 / artist_watch 105 / monthly 55 ...
```

设计要点:热度封顶避免爆款通吃;新鲜度衰减保证老作品会被挤下去;来源权重反映渠道可信度。

---

## 5. 调度器

调度器在 [`scheduler/index.ts`](../src/scheduler/index.ts),启动时自动起,通过 HTTP 自调用 `localhost:PORT` 触发任务。每个任务有独立的间隔和开关,全从环境变量读。

| 任务 | action | 默认间隔 | 默认启用 |
|------|--------|----------|----------|
| 日榜爬取 | `daily` | 24h | 是 |
| 周榜爬取 | `weekly` | 24h | 是 |
| 月榜爬取 | `monthly` | 24h | 是 |
| 首页推荐爬取 | `home` | 10 分钟 | 是 |
| 插画推荐任务处理 | `crawl-uncompleted`(illust_recommend) | 15 分钟 | 是 |
| 作者推荐任务处理 | `crawl-uncompleted`(author_recommend) | 15 分钟 | 是 |
| 详细信息任务处理 | `crawl-uncompleted`(detail_info) | 5 分钟 | 是 |
| Watch target 采集 | `collect-watch-targets` | 60 分钟 | 是 |
| 自动 TopN 预览下载 | `auto-topn-preview` | 60 分钟 | 是 |
| 补预览下载 | `run-backfill-preview` | 1440 分钟 | **否** |
| 全尺寸下载 worker | `run-full-download` | 5 分钟 | 是 |
| 存储状态对账 | `reconcile-storage` | 1440 分钟 | **否** |
| 候选评分刷新 | (内部,refresh-candidate-score) | 10 分钟 | 是 |

启动有 10 秒延迟 + 随机抖动,避免冷启动一窝蜂。可用 `scheduler-start` / `scheduler-stop` 控制,`scheduler-trigger&task=<action>` 手动触发单个。

---

## 6. 环境变量

完整列表见 [`server/.env.example`](../.env.example),关键项:

### 数据库(Turso / libSQL)

| 变量 | 必填 | 说明 |
|------|------|------|
| `TURSO_DATABASE_URL` | 是 | `file:./data/pixiv.db`(本地)或 `libsql://xxx.turso.io`(云端) |
| `TURSO_AUTH_TOKEN` | 远程必填 | 本地 `file:` 模式不需要 |
| `TURSO_SYNC_URL` | 否 | 本地副本同步 URL |
| `TURSO_BACKUP_URL` / `TURSO_BACKUP_AUTH_TOKEN` | 否 | 异地冷备目标 |

### Pixiv

| 变量 | 必填 | 说明 |
|------|------|------|
| `PIXIV_COOKIE` | 是 | 登录 Cookie |
| `PIXIV_USER_AGENT` / `PIXIV_REFERER` | 否 | 请求头定制 |

### B2 存储

| 变量 | 必填 | 说明 |
|------|------|------|
| `B2_APPLICATION_KEY_ID` / `B2_APPLICATION_KEY` | 下载功能必填 | 密钥 |
| `B2_BUCKET_NAME` / `B2_BUCKET_ID` | 下载功能必填 | 桶 |
| `B2_ENDPOINT` | 否 | 默认 `s3.us-west-004.backblazeb2.com` |
| `B2_BUCKET_URL` | 否 | 公开访问地址(Worker 代理) |
| `ARCHIVE_MAX_ORIGINAL_MB` | 否 | 原图超限自动降级到小尺寸,默认 10 |

### 服务器

| 变量 | 必填 | 说明 |
|------|------|------|
| `PORT` | 否 | 监听端口,默认 3000 |
| `SERVER_API_KEY` | 强烈推荐 | API key 鉴权,留空则不校验 |

### 调度器

每个任务有 `<TASK>_INTERVAL`(间隔,分钟)、`<TASK>_LIMIT`(数量)、`<TASK>_ENABLED`(开关)三类变量,前缀:
- `SCHEDULER_HOME_*` / `SCHEDULER_ILLUST_RECOMMEND_*` / `SCHEDULER_AUTHOR_RECOMMEND_*` / `SCHEDULER_DETAIL_INFO_*`
- `SCHEDULER_WATCH_TARGET_*`
- `SCHEDULER_AUTO_PREVIEW_*` / `SCHEDULER_BACKFILL_PREVIEW_*`
- `SCHEDULER_FULL_DOWNLOAD_*` / `SCHEDULER_RECONCILE_STORAGE_*`
- `SCHEDULER_CANDIDATE_SCORE_REFRESH_*`

### 下载参数

- `AUTO_PREVIEW_*`:`DEFAULT_LIMIT` / `MIN_POPULARITY` / `SIZES` / `QUOTA_*`(各来源配额)/ `*_DAYS`(各来源窗口)
- `BACKFILL_PREVIEW_*`:`DEFAULT_LIMIT` / `MIN_POPULARITY` / `MIN_AGE_DAYS` / `SIZES`
- `FULL_DOWNLOAD_*`:`DEFAULT_LIMIT` / `SIZES`
- `WATCH_TARGET_RUN_LIMIT` / `WATCH_TARGET_PER_TARGET_LIMIT`
- `CANDIDATE_SCORE_REFRESH_LIMIT`

---

## 7. 业务流程

整条管线五个阶段,数据像漏斗往下流:

```
发现 → 补全 → 打分 → 分级下载 → 业务方挑图
```

1. **发现**:排行榜 / 首页推荐 / watch_target 采集 → 入 `pic_task` + `pic_source`
2. **补全**:`crawl-uncompleted` 跑插画推荐 / 作者推荐 / 详情,补全关系网和数据(`detail_info` 是后续打分和下载的前提)
3. **打分**:`refresh-candidate-score` 算 `candidate_score` 写回 `pic` 表
4. **下载**:`auto-topn-preview`(近期高分预览)/ `run-backfill-preview`(老作品补预览)/ `enqueue-full-download`(全尺寸)→ `download_job` 队列 → 认领 → 下载到 B2 → 更新 `download_stage` / `image_variants`
5. **挑图**:上游业务调 `business-candidates` 按候选池选图,接口自动排除已发布的

代理接口 `proxy` 命中 B2 缓存则 302 重定向,未命中则回源 Pixiv 并异步归档,形成缓存预热。
