# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Pixiv爬虫 Serverless项目 - 基于 TypeScript 的 Pixiv 插画爬虫系统，采用 Serverless 架构，部署在 Vercel 平台，使用 Supabase (PostgreSQL) 作为数据库，Cloudflare R2 作为图片存储。

**新增**: `server/` 目录包含东京服务器专用逻辑，使用 Turso (libSQL) 数据库和 B2 存储，针对低延迟场景优化。

## Common Commands

```bash
# 安装依赖
npm install

# 开发模式（支持热重载）
npm run dev

# 构建项目
npm run build

# 本地运行编译后的代码
npm start

# 部署到 Vercel
npm run deploy

# 测试下载功能
npm run test:download

# 测试尺寸功能
npm run test:size
```

### Cloudflare Cron Worker 部署

```bash
cd cron_worker
npm install

# 配置环境变量（机密方式）
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE_KEY

# 部署定时任务
wrangler deploy
```

### 东京服务器 (server/)

```bash
cd server
npm install

# 初始化数据库表结构
npm run db:init

# 开发模式
npm run dev

# 构建并运行
npm run build
npm start

# 使用 PM2 部署
pm2 start dist/index.js --name pixiv-crawler
```

## Architecture

### 核心架构

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Vercel API    │────▶│  PixivCrawler    │────▶│   Supabase DB   │
│  (api/index.ts) │     │  (爬虫核心服务)   │     │   (PostgreSQL)  │
└─────────────────┘     └──────────────────┘     └─────────────────┘
         │                      │
         │              ┌───────┴───────┐
         │              │               │
         ▼              ▼               ▼
┌─────────────────┐  ┌──────────┐  ┌──────────────┐
│ PixivDownloader │  │PixivProxy│  │ Cloudflare   │
│ (图片下载服务)   │  │(图片代理) │  │ R2 Storage   │
└─────────────────┘  └──────────┘  └──────────────┘
```

### 目录结构

- `api/index.ts` - Vercel API 入口，简单导出 src/index.ts 的 handler
- `src/index.ts` - 主入口文件，包含所有 API 路由处理和 LogManager
- `src/services/` - 业务逻辑层
  - `pixiv-crawler.ts` - 爬虫核心服务，处理推荐算法、数据抓取
  - `pixiv-downloader.ts` - 图片下载服务，上传到 R2
  - `pixiv-proxy.ts` - 图片代理访问服务
- `src/database/supabase.ts` - Supabase 数据库服务封装
- `src/config/index.ts` - 环境配置、爬虫参数、Headers 生成
- `src/types/index.ts` - TypeScript 类型定义
- `src/utils/pixiv-utils.ts` - 工具函数（热度计算、数据解析等）
- `cron_worker/` - Cloudflare 定时任务，用于任务分发到工作节点

### 东京服务器目录 (server/)

- `server/src/index.ts` - 服务器入口，HTTP API 服务
- `server/src/db/turso.ts` - Turso (libSQL) 数据库服务，支持 Local Read Replica
- `server/src/db/schema.sql` - SQLite 表结构定义
- `server/src/config/` - 环境配置（Turso + B2）
- `server/src/types/` - 类型定义
- `server/src/utils/` - 工具函数

### 数据流

1. **爬取流程**: API请求 → PixivCrawler → Pixiv API → 数据处理 → Supabase入库
2. **下载流程**: API请求 → PixivDownloader → Pixiv图片服务器 → R2存储 → 更新数据库
3. **代理流程**: API请求 → PixivProxy → Pixiv图片服务器 → 返回图片数据
4. **定时任务**: Cron Worker → 主节点API → 获取任务 → 分发到从节点

### 关键类

- `PixivCrawler` - 爬虫核心类，支持插画推荐、作者推荐、排行榜抓取
- `PixivDownloader` - 下载器类，处理图片下载和R2上传
- `PixivProxy` - 代理类，处理图片代理访问
- `SupabaseService` - 数据库服务类，封装所有数据库操作
- `LogManager` - 日志管理器，支持文件持久化和任务ID过滤

## Environment Variables

必需配置:
- `SUPABASE_URL` - Supabase 项目 URL
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase 服务角色密钥
- `PIXIV_COOKIE` - Pixiv 登录 Cookie

R2存储配置（下载功能需要）:
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_ACCESS_KEY_ID`
- `CLOUDFLARE_SECRET_ACCESS_KEY`
- `CLOUDFLARE_BUCKET_NAME`

## API Endpoints

GET 请求:
- `?action=status` - 服务状态
- `?action=stats` - 统计信息
- `?action=env-check` - 环境变量检查
- `?action=logs&taskId=xxx` - 获取日志
- `?action=proxy-image&pid=xxx&size=xxx` - 代理访问图片
- `?action=random-pids&count=10` - 随机获取PID
- `?action=illust-recommend-pids&pid=xxx` - 插画推荐PID
- `?action=author-recommend-pids&pid=xxx` - 作者推荐PID
- `?action=pid-detail-info&pid=xxx` - PID详细信息
- `?action=daily/weekly/monthly` - 排行榜抓取

POST 请求:
- `{pid, targetNum, popularityThreshold}` - 单个PID爬取
- `{pids, targetNum, popularityThreshold}` - 批量PID爬取
- `{action: "download", downloadPid}` - 单个下载
- `{action: "download", downloadPids}` - 批量下载

## Database Tables

主表 `pic`:
- `pid` (主键) - Pixiv作品ID
- `title`, `author_id`, `author_name` - 作品信息
- `tag` - 标签列表（JSON格式）
- `good`, `star`, `view` - 点赞、收藏、浏览数
- `popularity` - 热度评分
- `image_path`, `image_url` - 图片路径
- `size` - 文件大小

任务表 `pic_task`:
- 用于存储待爬取的PID任务

排行榜表 `pic_ranking`:
- 存储日榜、周榜、月榜数据

## Key Algorithms

热度计算公式:
```
popularity = (点赞数 × 0.55 + 收藏数 × 0.45) ÷ 浏览量
```

## Notes

- `cf_worker_pixiv_crawler/` 目录不可用（Cloudflare IP 被 Pixiv 封禁）
- Vercel 函数配置: maxDuration=60s, memory=1024MB, region=hkg1
- 爬虫配置在 `src/config/index.ts` 的 `CRAWLER_CONFIG` 中

## 东京服务器 (server/) 说明

### 数据库差异

| 特性 | Vercel (Supabase) | 东京服务器 (Turso) |
|------|-------------------|-------------------|
| 数据库类型 | PostgreSQL | SQLite (libSQL) |
| 查询语法 | Supabase SDK | 原生 SQL |
| Upsert | `.upsert()` | `ON CONFLICT DO UPDATE` |
| 本地副本 | 无 | Local Read Replica |

### Turso 环境变量

```env
TURSO_DATABASE_URL=libsql://xxx.turso.io
TURSO_AUTH_TOKEN=your_token
TURSO_SYNC_URL=file:///path/to/local.db  # 可选，启用本地副本
```

### TursoService 关键方法

- `upsertPic(pic)` - 使用 `ON CONFLICT(pid) DO UPDATE` 实现 upsert
- `existsPid(pid)` - 高性能去重检查（利用本地副本可达微秒级）
- `getExistingPids(pids)` - 批量去重检查
- `batchCreatePicTasks(pids)` - 使用事务批量创建任务
