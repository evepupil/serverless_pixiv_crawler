# 🎨 Pixiv爬虫 Serverless项目

[![TypeScript](https://img.shields.io/badge/TypeScript-5.2+-blue.svg)](https://www.typescriptlang.org/)
[![Vercel](https://img.shields.io/badge/Vercel-Deployed-black.svg)](https://vercel.com/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-green.svg)](https://supabase.com/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

这是一个现代化的 Pixiv 插画爬虫系统，采用 **Serverless 架构**，使用 TypeScript 开发，集成 Supabase 数据库，部署在 Vercel 平台。系统具备智能推荐、热度计算、防封机制等高级功能。

> ⚠️ **重要声明**
>
> - **本项目仅供学习与技术交流使用**，请勿用于任何商业或违反目标网站条款的用途。
> - 使用本项目需遵守所在地法律法规与 Pixiv 的服务条款。
> - **请务必合理控制爬取频率**，建议每分钟不超过1-2个请求，避免对目标网站造成压力。
> - 作者不对任何滥用行为承担责任，请自觉、合理地使用本项目。
> - **学习目的**：本项目主要用于学习 Serverless 架构、API 设计和数据处理技术。
> - 🚫 **cf_worker_pixiv_crawler 目录不可用**：由于 Cloudflare Worker 的 IP 已被 Pixiv 封禁，该目录下的直接爬虫实现无法正常工作

## ⚠️ Cloudflare Workers 使用说明

本仓库包含两个与 Cloudflare Workers 相关的目录：
- `cron_worker/`：用于定时触发任务分发，通过 Supabase 读取任务并分发到节点
- `cf_worker_pixiv_crawler/`：尝试在 Cloudflare Workers 内直接抓取 Pixiv 内容的实现，由于 Pixiv 对 Cloudflare 的出口 IP 封禁，该目录下的功能不可用



## ✅ 合理使用建议

- 建议控制抓取速率：
  - 详情页抓取：建议每个节点每分钟 1~2 个 PID，增加 1~3 秒随机延迟。
  - 列表/推荐抓取：更低频率，避免集中高峰时段。
- 使用稳定代理或自建出口，避免公共代理/被封锁的 IP。
- 为节点设置失败重试与熔断，避免持续对目标站点施压。

## ⏱️ Cloudflare Cron Worker（可用）

- 作用：
  - 每 10 分钟：从数据库选取未爬取的“插画推荐/作者推荐”任务，分发给你的工作节点。
  - 每 1 分钟：从数据库选取未爬取“详细信息”的 PID 任务，分发给你的工作节点。
- 配置位置：`cron_worker/wrangler.toml`
  - 已内置以下定时表达式：`*/10 * * * *`、`* * * * *`、`0 1 * * *`、`0 1 * * 1`、`0 1 1 * *`
- 必要环境变量：
  - `PRIMARY_API_BASE`：主节点 API（不要以斜杠结尾）。
  - `WORKER_API_BASES`：从节点 API 列表，逗号分隔。
  - `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`：用于访问 Supabase 的 pic_task 表（请以 Secret 方式配置）。

部署与配置示例（在 cron_worker 目录内）：

```bash
# 设置机密（不要直接写入 wrangler.toml）
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE_KEY

# 部署
wrangler deploy
```

> 说明：Cron Worker 只负责“读取任务并分发”，不会直接请求 Pixiv。实际抓取由你配置在 `PRIMARY_API_BASE/WORKER_API_BASES` 对应的服务来执行。


## ✨ 项目特性

- 🚀 **Serverless架构**: 基于Vercel部署，零运维成本，自动扩容
- 🔧 **TypeScript**: 完整的类型安全支持，提升开发效率
- 🗄️ **Supabase数据库**: PostgreSQL + 实时数据同步
- 🕷️ **智能爬虫**: 递归推荐算法，智能发现优质内容
- 📥 **图片下载**: 支持下载图片到Cloudflare R2存储
- 🔄 **防封机制**: 多Header轮换 + 随机延迟 + 请求频率控制
- 📊 **数据统计**: 热度计算、标签分析、实时监控
- 🌐 **Web界面**: 现代化UI，实时日志，任务管理
- 🛡️ **错误处理**: 智能异常识别，友好错误提示
- 📱 **响应式设计**: 支持桌面和移动端访问


## 🛠️ 技术栈

### 核心技术
- **运行时**: Node.js 20+
- **语言**: TypeScript 5.2+
- **框架**: Vercel Serverless Functions
- **数据库**: Supabase (PostgreSQL)

### 依赖库
- **HTTP客户端**: Axios 1.6+
- **HTML解析**: Cheerio 1.0+
- **环境配置**: dotenv 16.3+
- **数据库SDK**: @supabase/supabase-js 2.38+
- **云存储**: @aws-sdk/client-s3 3.470+ (Cloudflare R2兼容)

## 🚀 快速开始

### ⚠️ 部署前须知

在开始部署之前，请了解项目的推荐使用场景：

- **推荐使用场景**：
  - 🎯 **学习 Serverless 架构**：了解 Vercel + Cloudflare Workers 的开发模式
  - 🖼️ **图片代理服务**：为现有 Pixiv 图片提供代理访问
  - 📊 **数据管理**：管理已有的 Pixiv 作品数据
  - ⏰ **定时任务**：使用 Cloudflare Cron Worker 进行任务调度

### 1. 环境准备

```bash
# 克隆项目
git clone <repository-url>
cd serverless_pixiv_crawler

# 安装依赖
npm install
```

### 2. 环境配置

复制环境变量文件并配置：

```bash
# Windows
copy env.example .env

# Linux/macOS
cp env.example .env
```

编辑 `.env` 文件，填入你的配置：

```env
# Supabase配置
SUPABASE_URL=your_supabase_url_here
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here

# Pixiv配置
PIXIV_COOKIE=your_pixiv_cookie_here

# Cloudflare R2配置（可选）
CLOUDFLARE_ACCOUNT_ID=your_cloudflare_account_id_here
CLOUDFLARE_ACCESS_KEY_ID=your_cloudflare_access_key_id_here
CLOUDFLARE_SECRET_ACCESS_KEY=your_cloudflare_secret_access_key_here
CLOUDFLARE_BUCKET_NAME=your_cloudflare_bucket_name_here
CLOUDFLARE_REGION=auto

# 爬虫配置
MAX_ILLUSTRATIONS=1000
POPULARITY_THRESHOLD=0.22
REQUEST_DELAY_MIN=1000
REQUEST_DELAY_MAX=3000
MAX_REQUESTS_PER_HEADER=300
```

> 💡 **提示**: 详细的配置说明请参考 [部署文档](docs/DEPLOYMENT.md)

### 3. 数据库初始化

在 Supabase 控制台中执行 `supabase/init.sql` 文件来创建数据库表结构和索引。

### 4. 本地开发

```bash
# 开发模式（支持热重载）
npm run dev

# 构建项目
npm run build

# 本地运行编译后的代码
npm start
```

### 5. 部署到生产环境

```bash
# 部署到 Vercel
npm run deploy

# 或者通过 Vercel CLI
vercel --prod
```

### 6. 部署 Cloudflare Cron Worker（可选）

如果需要使用定时任务功能：

```bash
cd cron_worker
npm install

# 配置环境变量
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE_KEY

# 部署定时任务
wrangler deploy
```

部署成功后，您将获得一个可访问的 URL。

## 📖 使用方法

### 🌐 Web 界面（推荐）

访问部署后的 URL，您将看到一个现代化的 Web 界面：

- **📊 实时监控**: 查看服务状态、数据库统计
- **🚀 任务管理**: 启动单个或批量爬取任务
- **📥 图片下载**: 下载图片到Cloudflare R2存储
- **📝 实时日志**: 查看任务执行过程和结果
- **⚙️ 参数配置**: 设置目标数量和热度阈值

> 💡 **提示**: 详细的界面使用说明请参考 [Web界面文档](docs/WEB_INTERFACE.md)

### 🔌 API 接口

#### 获取服务状态
```bash
GET /api/?action=status

# 响应示例
{
  "status": "running",
  "database": "connected",
  "pixiv": "available"
}
```

#### 获取统计信息
```bash
GET /api/?action=stats

# 响应示例
{
  "totalPics": 15420,
  "downloadedPics": 12350,
  "averagePopularity": 0.34
}
```

#### 获取日志
```bash
GET /api/?action=logs&taskId=single_123456_1234567890

# 响应示例
{
  "logs": [
    {
      "id": "1",
      "timestamp": "2025-01-11T10:30:00Z",
      "message": "开始爬取PID: 123456",
      "type": "info"
    }
  ]
}
```

#### 代理访问图片
```bash
GET /api/?action=proxy-image&pid=123456789&size=regular

# 参数说明
# pid: 必需，Pixiv作品ID
# size: 可选，图片尺寸 (thumb_mini|small|regular|original)
#       不指定时按优先级自动选择: thumb_mini → small → regular → original

# 成功响应: 直接返回图片二进制数据
# Content-Type: image/jpeg|image/png|image/gif 等
# Cache-Control: public, max-age=3600

# 失败响应示例
{
  "success": false,
  "error": "图片代理访问失败"
}
```

#### 获取随机PID列表
```bash
GET /api/?action=random-pids&count=10

# 参数说明
# count: 可选，返回的PID数量，默认10个，最大100个

# 响应示例
{
  "success": true,
  "pids": ["123456", "789012", "345678"],
  "count": 3
}
```

#### 获取插画推荐PID
```bash
GET /api/?action=illust-recommend-pids&pid=123456&targetNum=30

# 参数说明
# pid: 必需，基础PID
# targetNum: 可选，目标推荐数量，默认30

# 响应示例
{
  "success": true,
  "recommendPids": ["111111", "222222"],
  "count": 2
}
```

#### 获取作者推荐PID
```bash
GET /api/?action=author-recommend-pids&pid=123456&targetNum=30

# 参数说明
# pid: 必需，基础PID
# targetNum: 可选，目标推荐数量，默认30

# 响应示例
{
  "success": true,
  "authorRecommendPids": ["333333", "444444"],
  "count": 2
}
```

#### 获取PID详细信息
```bash
GET /api/?action=pid-detail-info&pid=123456

# 响应示例
{
  "success": true,
  "pidInfo": {
    "pid": "123456",
    "title": "作品标题",
    "tags": ["标签1", "标签2"],
    "good": 1000,
    "star": 500,
    "view": 10000,
    "popularity": 0.35
  }
}
```

#### 触发排行榜爬取
```bash
GET /api/?action=daily    # 日榜
GET /api/?action=weekly   # 周榜
GET /api/?action=monthly  # 月榜

# 响应示例
{
  "success": true,
  "message": "日榜爬取任务已启动",
  "taskId": "daily_ranking_1736598123456"
}
```

#### 启动单个PID爬取
```bash
POST /api/
Content-Type: application/json

{
  "pid": "133592668",
  "targetNum": 100,
  "popularityThreshold": 0.22
}

# 响应示例
{
  "success": true,
  "message": "爬虫任务启动成功",
  "taskId": "single_133592668_1736598123456"
}
```

#### 批量爬取
```bash
POST /api/
Content-Type: application/json

{
  "pids": ["133592668", "119603355"],
  "targetNum": 50,
  "popularityThreshold": 0.25
}

# 响应示例
{
  "success": true,
  "message": "批量爬取任务启动成功",
  "taskId": "batch_2_1736598123456",
  "totalPids": 2
}
```

#### 启动单个PID下载任务
```bash
POST /api/
Content-Type: application/json

{
  "action": "download",
  "downloadPid": "133592668"
}

# 响应示例
{
  "success": true,
  "message": "下载任务启动成功",
  "taskId": "download_133592668_1736598123456"
}
```

#### 启动批量PID下载任务
```bash
POST /api/
Content-Type: application/json

{
  "action": "download",
  "downloadPids": ["133592668", "119603355"]
}

# 响应示例
{
  "success": true,
  "message": "批量下载任务启动成功",
  "taskId": "batch_download_2_1736598123456",
  "totalPids": 2
}
```



> 📚 **完整API文档**: 请参考 [API文档](docs/API_DOCUMENTATION.md) 和 [下载API文档](docs/DOWNLOAD_API.md)

## 📁 项目结构

```
📦 serverless_pixiv_crawler/
├── 📁 api/                    # Vercel API 路由
│   └── index.ts              # API 入口文件
├── 📁 cron_worker/           # Cloudflare定时任务
│   ├── src/
│   │   └── index.ts          # 定时任务逻辑，用于任务分发
│   ├── wrangler.toml         # Cloudflare Worker 配置
│   └── package.json          # 依赖配置
├── 📁 cf_worker_pixiv_crawler/ # Cloudflare Worker爬虫（不可用）
│   └── ...                   # 由于IP封禁，此目录功能已失效
├── 📁 docs/                  # 项目文档
│   ├── API_DOCUMENTATION.md  # API 接口文档
│   ├── DOWNLOAD_API.md       # 下载功能API文档
│   ├── ARCHITECTURE.md       # 架构设计文档
│   ├── DEPLOYMENT.md         # 部署指南
│   ├── USAGE.md             # 使用说明
│   └── WEB_INTERFACE.md     # Web 界面文档
├── 📁 src/                   # 源代码目录
│   ├── 📁 config/           # 配置管理
│   │   └── index.ts         # 环境配置和常量
│   ├── 📁 database/         # 数据库层
│   │   └── supabase.ts      # Supabase 数据库服务
│   ├── 📁 services/         # 业务逻辑层
│   ├── pixiv-crawler.ts # Pixiv 爬虫核心服务
│   ├── pixiv-downloader.ts # Pixiv 图片下载服务
│   └── pixiv-proxy.ts   # Pixiv 图片代理访问服务
│   ├── 📁 templates/        # HTML 模板
│   │   └── index.html       # Web 界面模板
│   ├── 📁 types/           # TypeScript 类型定义
│   │   └── index.ts        # 接口和类型声明
│   ├── 📁 utils/           # 工具函数
│   │   └── pixiv-utils.ts  # Pixiv 相关工具函数
│   └── index.ts            # 主入口文件和路由
├── 📁 supabase/            # 数据库脚本
│   └── init.sql            # 数据库初始化 SQL
├── 📄 test-pic-task.js     # 测试脚本
├── 📄 env.example          # 环境变量模板
├── 📄 package.json         # 项目依赖和脚本
├── 📄 tsconfig.json        # TypeScript 配置
├── 📄 vercel.json          # Vercel 部署配置
└── 📄 README.md           # 项目说明文档
```

### 🗂️ 核心模块说明

| 模块 | 功能描述 | 状态 |
|------|----------|------|
| **api/** | Vercel Serverless Functions 入口 | 正常 |
| **src/services/** | 爬虫核心逻辑，包含推荐算法、数据处理和图片代理 | 正常 |
| **src/database/** | 数据库操作封装，支持 CRUD 和统计查询 | 正常 |
| **src/utils/** | 热度计算、数据解析等工具函数 | 正常 |
| **src/config/** | 环境变量管理和配置常量 | 正常 |
| **src/types/** | TypeScript 类型定义，确保类型安全 | 正常 |
| **cron_worker/** | Cloudflare 定时任务，用于任务分发 | 正常 |
| **cf_worker_pixiv_crawler/** | Cloudflare Worker 直接爬虫 | 不可用 |
| **docs/** | 完整的项目文档，包含使用指南和架构说明 | 正常 |

### 📊 功能状态详情

| 功能模块 | 状态 | 说明 |
|---------|------|------|
| 🖼️ 图片代理访问 | 正常 | 可以正常代理访问 Pixiv 图片 |
| 🗄️ 数据库操作 | 正常 | Supabase 数据库功能完全可用 |
| ⏰ 定时任务 | 正常 | Cloudflare Cron Worker 可正常工作 |
| 🌐 Web 界面 | 正常 | 管理界面可正常访问 |
| 🕷️ 直接爬虫 | 正常 | 爬虫功能正常可用 |
| 📥 图片下载 | 正常 | 图片下载功能正常 |
| 📊 数据统计 | 正常 | 数据分析和统计功能正常 |
| 🔍 内容搜索 | 正常 | 基于现有数据的搜索功能正常 |

## 🎯 核心功能

### 1. 🧠 智能推荐系统
- **递归推荐算法**: 基于起始PID深度挖掘相关优质内容
- **多维度推荐**: 结合插画推荐和作者推荐，扩大发现范围
- **智能去重**: 自动过滤重复内容，提高爬取效率
- **动态调整**: 根据目标数量自动调整推荐深度

### 2. 📊 热度计算算法
```
热度 = (点赞数 × 0.55 + 收藏数 × 0.45) ÷ 浏览量
```
- **多因子评估**: 综合点赞、收藏、浏览数据
- **权重优化**: 点赞55%，收藏45%，科学反映内容质量
- **低浏览量惩罚**: 新作品防虚高机制
- **阈值过滤**: 可配置热度阈值，确保内容质量

### 3. 🏷️ 智能标签系统
- **多语言支持**: 自动处理中英文标签
- **黑名单过滤**: 自动过滤不适宜内容
- **标签分析**: 统计热门标签和趋势
- **组合查询**: 支持多标签精确匹配

### 4. 🛡️ 防封机制
- **Header轮换**: 每300次请求自动切换身份
- **随机延迟**: 0-1秒随机间隔，模拟人工操作
- **频率控制**: 智能调节请求速度
- **异常重试**: 自动处理网络异常和限流

### 5. 🖼️ 图片代理访问
- **智能尺寸选择**: 按优先级自动选择最佳图片尺寸
- **多格式支持**: 支持 JPEG、PNG、GIF、WebP 等格式
- **缓存优化**: 1小时浏览器缓存，提升访问速度
- **错误容错**: 单个尺寸失败时自动尝试其他尺寸
- **跨域支持**: 设置 CORS 头，支持前端直接调用

### 6. 📈 实时监控
- **任务状态**: 实时显示爬取进度和统计
- **错误处理**: 智能识别并友好提示各类异常
- **性能监控**: 成功率、响应时间等关键指标
- **日志系统**: 分级日志记录，便于问题排查

## 🗄️ 数据库设计

### 主表结构 (`pic`)

| 字段 | 类型 | 说明 | 索引 |
|------|------|------|------|
| `pid` | VARCHAR(255) | Pixiv作品ID（主键） | ✅ PRIMARY |
| `tag` | TEXT | 标签列表（JSON格式） | ✅ GIN全文搜索 |
| `good` | INTEGER | 点赞数 | - |
| `star` | INTEGER | 收藏数 | - |
| `view` | INTEGER | 浏览数 | - |
| `popularity` | DECIMAL(10,4) | 热度评分 | ✅ DESC排序 |
| `image_path` | VARCHAR(255) | 本地图片路径 | - |
| `image_url` | VARCHAR(255) | 原始图片URL | - |
| `download_time` | VARCHAR(255) | 下载时间 | ✅ 时间查询 |
| `upload_time` | VARCHAR(255) | 上传时间 | - |
| `wx_url` | VARCHAR(255) | 微信图片URL | - |
| `wx_name` | VARCHAR(255) | 微信文件名 | ✅ 上传状态 |
| `unfit` | BOOLEAN | 是否不适宜 | ✅ 内容过滤 |
| `created_at` | TIMESTAMP | 创建时间 | - |
| `updated_at` | TIMESTAMP | 更新时间 | - |

### 🔍 索引优化策略

```sql
-- 热度排序索引（最常用）
CREATE INDEX idx_pic_popularity ON pic(popularity DESC);

-- 全文搜索索引（标签查询）
CREATE INDEX idx_pic_tags ON pic USING GIN(to_tsvector('english', tag));

-- 时间查询索引
CREATE INDEX idx_pic_download_time ON pic(download_time);

-- 内容过滤索引
CREATE INDEX idx_pic_unfit ON pic(unfit);
```

### 📊 统计视图

```sql
-- 实时统计视图
CREATE VIEW pic_stats AS
SELECT 
    COUNT(*) as total_pics,
    COUNT(CASE WHEN image_path IS NOT NULL THEN 1 END) as downloaded_pics,
    AVG(popularity) as avg_popularity,
    MAX(popularity) as max_popularity
FROM pic;
```

## ⚙️ 配置说明

### 🕷️ 爬虫参数配置

| 配置项 | 说明 | 默认值 | 推荐范围 |
|--------|------|--------|----------|
| `MAX_ILLUSTRATIONS` | 单次最大爬取数量 | 1000 | 100-2000 |
| `POPULARITY_THRESHOLD` | 热度阈值过滤 | 0.22 | 0.15-0.35 |
| `REQUEST_DELAY_MIN` | 最小请求延迟(ms) | 0 | 0-500 |
| `REQUEST_DELAY_MAX` | 最大请求延迟(ms) | 1000 | 500-2000 |
| `MAX_REQUESTS_PER_HEADER` | Header轮换频率 | 300 | 200-500 |

### 🔐 Pixiv API 配置

```env
# 必需配置
PIXIV_COOKIE=your_pixiv_session_cookie
PIXIV_USER_AGENT=Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0
PIXIV_REFERER=https://www.pixiv.net/artworks/112388359

# 可选配置
PIXIV_ACCEPT_LANGUAGE=zh-CN,zh;q=0.8,zh-TW;q=0.2
```

### 🗄️ Supabase 数据库配置

```env
# 数据库连接
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

> 💡 **配置提示**: 
> - 热度阈值建议根据需求调整：0.15（宽松）、0.22（平衡）、0.35（严格）
> - 请求延迟可根据网络状况调整，避免过于频繁被限流
> - Cookie需要定期更新，建议设置监控告警

## ⚠️ 注意事项

### 🔐 安全相关
1. **Cookie管理**: 定期更新Pixiv Cookie，避免失效导致爬取中断
2. **环境变量**: 妥善保管数据库密钥，不要提交到代码仓库
3. **访问控制**: 生产环境建议设置访问限制和身份验证

### 🚦 使用规范
1. **请求频率**: 遵守Pixiv服务条款，避免过于频繁的请求
2. **内容合规**: 注意过滤不适宜内容，遵守当地法律法规
3. **资源使用**: 合理设置爬取数量，避免过度消耗服务器资源

### 📊 监控建议
1. **状态监控**: 建议设置爬虫运行状态和错误率监控
2. **数据备份**: 定期备份Supabase数据，防止数据丢失
3. **性能监控**: 关注响应时间和成功率指标

## 🔧 故障排除

### 常见问题及解决方案

#### 1. 🔌 Supabase连接失败
```bash
# 检查环境变量
echo $SUPABASE_URL
echo $SUPABASE_ANON_KEY

# 测试网络连接
curl -I https://your-project.supabase.co
```
**解决方案**:
- 确认环境变量配置正确
- 检查Supabase项目状态
- 验证网络连接和防火墙设置

#### 2. 🍪 Pixiv请求失败
```bash
# 检查Cookie有效性
curl -H "Cookie: your_cookie" https://www.pixiv.net/ajax/user/123456
```
**解决方案**:
- 更新Pixiv登录Cookie
- 检查User-Agent和Referer配置
- 确认IP地址未被Pixiv限制

#### 3. 💾 内存不足错误
**解决方案**:
- 减少`targetNum`参数值
- 优化数据库查询，使用分页
- 增加Vercel函数内存限制

#### 4. 🚫 部署失败
**解决方案**:
- 检查`vercel.json`配置
- 确认所有依赖已正确安装
- 查看Vercel构建日志排查错误

## 📚 文档导航

| 文档 | 描述 | 适用人群 |
|------|------|----------|
| [📖 使用指南](docs/USAGE.md) | 详细的使用说明和最佳实践 | 所有用户 |
| [🚀 部署指南](docs/DEPLOYMENT.md) | 完整的部署流程和配置说明 | 开发者 |
| [🔌 API文档](docs/API_DOCUMENTATION.md) | 完整的API接口文档 | 开发者 |
| [🌐 Web界面](docs/WEB_INTERFACE.md) | Web界面使用说明 | 普通用户 |
| [🏗️ 架构文档](docs/ARCHITECTURE.md) | 系统架构和技术实现详解 | 架构师/高级开发者 |

## 🤝 贡献指南

我们欢迎所有形式的贡献！

### 🐛 报告问题
- 使用 [Issues](../../issues) 报告Bug
- 提供详细的错误信息和复现步骤
- 包含环境信息（Node.js版本、操作系统等）

### 💡 功能建议
- 在 [Issues](../../issues) 中提出新功能建议
- 详细描述功能需求和使用场景
- 欢迎提供设计方案和实现思路

### 🔧 代码贡献
1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

## 📄 许可证

本项目采用 [MIT License](LICENSE) 开源协议。

## 📞 联系方式

- 📧 **问题反馈**: 通过 [Issues](../../issues) 提交
- 💬 **技术讨论**: 欢迎在 [Discussions](../../discussions) 中交流
- 🌟 **项目支持**: 如果觉得项目有用，请给个 Star ⭐

---

<div align="center">

**🎨 让优质的Pixiv内容触手可及 🎨**

*最后更新: 2025-01-11*

</div>