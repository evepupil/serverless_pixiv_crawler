# Pixiv爬虫 Serverless项目

这是一个使用TypeScript和Supabase重构的Pixiv爬虫项目，采用serverless架构部署。

## 项目特性

- 🚀 **Serverless架构**: 基于Vercel部署，无需管理服务器
- 🔧 **TypeScript**: 完整的类型安全支持
- 🗄️ **Supabase**: 使用PostgreSQL数据库，支持实时数据同步
- 🕷️ **智能爬虫**: 支持递归推荐、标签过滤、热度计算
- 🔄 **多Header轮换**: 防止被Pixiv封禁
- 📊 **数据统计**: 支持图片热度、标签分析等

## 技术栈

- **后端**: TypeScript, Node.js
- **数据库**: Supabase (PostgreSQL)
- **部署**: Vercel Serverless Functions
- **HTTP客户端**: Axios
- **HTML解析**: Cheerio

## 快速开始

### 1. 环境准备

```bash
# 克隆项目
git clone <repository-url>
cd pixiv-crawler-serverless

# 安装依赖
npm install
```

### 2. 环境配置

复制环境变量文件并配置：

```bash
cp env.example .env
```

编辑 `.env` 文件，填入你的配置：

```env
# Supabase配置
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Pixiv配置
PIXIV_COOKIE=your_pixiv_cookie_here

# 爬虫配置
MAX_ILLUSTRATIONS=1000
POPULARITY_THRESHOLD=0.22
```

### 3. 数据库初始化

在Supabase中执行 `supabase/init.sql` 文件来创建数据库表结构。

### 4. 本地开发

```bash
# 开发模式
npm run dev

# 构建项目
npm run build

# 本地运行
npm start
```

### 5. 部署

```bash
# 部署到Vercel
npm run deploy
```

## 使用方法

### API接口

#### 获取服务状态
```bash
GET /?action=status
```

#### 根据标签获取图片
```bash
GET /?action=pics&tags=碧蓝档案,黑丝&limit=10
```

#### 启动爬虫任务
```bash
POST /
Content-Type: application/json

{
  "pid": "12345678",
  "targetNum": 1000
}
```

#### 批量爬取
```bash
POST /
Content-Type: application/json

{
  "pids": ["12345678", "87654321"],
  "targetNum": 500
}
```

### 命令行使用

```bash
# 爬取单个PID
npm run dev 12345678

# 指定目标数量
npm run dev 12345678 500
```

## 项目结构

```
src/
├── config/          # 配置文件
├── database/        # 数据库操作
├── services/        # 核心服务
├── types/          # TypeScript类型定义
├── utils/          # 工具函数
└── index.ts        # 主入口文件

supabase/
└── init.sql        # 数据库初始化SQL

vercel.json         # Vercel配置
package.json        # 项目依赖
tsconfig.json       # TypeScript配置
```

## 核心功能

### 1. 智能推荐系统
- 基于插画ID获取相关推荐
- 递归获取更多相关插画
- 支持作者推荐和插画推荐

### 2. 热度计算
- 综合点赞数、收藏数、浏览数
- 动态调整算法，考虑低浏览量插画
- 可配置热度阈值

### 3. 标签过滤
- 支持多标签组合查询
- 黑名单标签过滤
- 标签翻译支持（中英文）

### 4. 反爬虫策略
- 随机延迟请求
- 多Header轮换
- 请求频率控制

## 数据库设计

### 主要表结构

- **pic**: 存储插画信息和元数据

### 索引优化

- 标签全文搜索索引
- 热度排序索引
- 时间索引

## 配置说明

### 爬虫配置

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| MAX_ILLUSTRATIONS | 最大爬取插画数量 | 1000 |
| POPULARITY_THRESHOLD | 热度阈值 | 0.22 |
| REQUEST_DELAY_MIN | 最小请求延迟(ms) | 0 |
| REQUEST_DELAY_MAX | 最大请求延迟(ms) | 1000 |
| MAX_REQUESTS_PER_HEADER | 每个Header最大请求数 | 300 |

### Pixiv配置

- 支持多个Cookie轮换
- 可配置User-Agent和Referer
- 支持多语言设置

## 注意事项

1. **Cookie管理**: 定期更新Pixiv Cookie，避免失效
2. **请求频率**: 控制请求频率，避免被Pixiv封禁
3. **数据备份**: 定期备份Supabase数据
4. **监控告警**: 建议设置爬虫运行状态监控

## 故障排除

### 常见问题

1. **Supabase连接失败**
   - 检查环境变量配置
   - 确认网络连接正常

2. **Pixiv请求失败**
   - 检查Cookie是否有效
   - 尝试更换Header配置
   - 检查IP是否被限制

3. **内存不足**
   - 减少批量处理数量
   - 优化数据库查询

## 贡献指南

欢迎提交Issue和Pull Request！

## 许可证

MIT License

## 联系方式

如有问题，请提交Issue或联系维护者。 