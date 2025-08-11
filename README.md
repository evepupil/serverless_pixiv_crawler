# 🎨 Pixiv爬虫 Serverless项目

[![TypeScript](https://img.shields.io/badge/TypeScript-5.2+-blue.svg)](https://www.typescriptlang.org/)
[![Vercel](https://img.shields.io/badge/Vercel-Deployed-black.svg)](https://vercel.com/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-green.svg)](https://supabase.com/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

这是一个现代化的 Pixiv 插画爬虫系统，采用 **Serverless 架构**，使用 TypeScript 开发，集成 Supabase 数据库，部署在 Vercel 平台。系统具备智能推荐、热度计算、防封机制等高级功能。

## ✨ 项目特性

- 🚀 **Serverless架构**: 基于Vercel部署，零运维成本，自动扩容
- 🔧 **TypeScript**: 完整的类型安全支持，提升开发效率
- 🗄️ **Supabase数据库**: PostgreSQL + 实时数据同步
- 🕷️ **智能爬虫**: 递归推荐算法，智能发现优质内容
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

## 🚀 快速开始

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
# Supabase 数据库配置
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Pixiv API 配置
PIXIV_USER_AGENT=Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0
PIXIV_COOKIE=your_pixiv_cookie_here
PIXIV_REFERER=https://www.pixiv.net/artworks/112388359

# 爬虫参数配置
MAX_ILLUSTRATIONS=1000
POPULARITY_THRESHOLD=0.22
REQUEST_DELAY_MIN=0
REQUEST_DELAY_MAX=1000
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

部署成功后，您将获得一个可访问的 URL，可以通过 Web 界面管理爬虫任务。

## 📖 使用方法

### 🌐 Web 界面（推荐）

访问部署后的 URL，您将看到一个现代化的 Web 界面：

- **📊 实时监控**: 查看服务状态、数据库统计
- **🚀 任务管理**: 启动单个或批量爬取任务
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

> 📚 **完整API文档**: 请参考 [API文档](docs/API_DOCUMENTATION.md)

## 📁 项目结构

```
📦 serverless_pixiv_crawler/
├── 📁 api/                    # Vercel API 路由
│   └── index.ts              # API 入口文件
├── 📁 docs/                  # 项目文档
│   ├── API_DOCUMENTATION.md  # API 接口文档
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
│   │   └── pixiv-crawler.ts # Pixiv 爬虫核心服务
│   ├── 📁 templates/        # HTML 模板
│   │   └── index.html       # Web 界面模板
│   ├── 📁 types/           # TypeScript 类型定义
│   │   └── index.ts        # 接口和类型声明
│   ├── 📁 utils/           # 工具函数
│   │   └── pixiv-utils.ts  # Pixiv 相关工具函数
│   └── index.ts            # 主入口文件和路由
├── 📁 supabase/            # 数据库脚本
│   └── init.sql            # 数据库初始化 SQL
├── 📄 env.example          # 环境变量模板
├── 📄 package.json         # 项目依赖和脚本
├── 📄 tsconfig.json        # TypeScript 配置
├── 📄 vercel.json          # Vercel 部署配置
└── 📄 README.md           # 项目说明文档
```

### 🗂️ 核心模块说明

| 模块 | 功能描述 |
|------|----------|
| **api/** | Vercel Serverless Functions 入口 |
| **src/services/** | 爬虫核心逻辑，包含推荐算法和数据处理 |
| **src/database/** | 数据库操作封装，支持 CRUD 和统计查询 |
| **src/utils/** | 热度计算、数据解析等工具函数 |
| **src/config/** | 环境变量管理和配置常量 |
| **src/types/** | TypeScript 类型定义，确保类型安全 |
| **docs/** | 完整的项目文档，包含使用指南和架构说明 |

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

### 5. 📈 实时监控
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
SUPABASE_ANON_KEY=your_anon_key
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