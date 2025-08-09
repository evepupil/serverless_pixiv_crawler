# 部署指南

本文档详细说明如何将Pixiv爬虫项目部署到Vercel和Supabase。

## 1. Supabase设置

### 1.1 创建Supabase项目

1. 访问 [Supabase官网](https://supabase.com/)
2. 点击 "Start your project" 创建新项目
3. 选择组织或创建新组织
4. 填写项目信息：
   - 项目名称：`pixiv-crawler`
   - 数据库密码：设置一个强密码
   - 地区：选择离你最近的地区

### 1.2 获取连接信息

项目创建完成后，在项目设置中找到：

- **Project URL**: 类似 `https://xxxxxxxxxxxxx.supabase.co`
- **anon public key**: 类似 `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`
- **service_role key**: 类似 `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`

### 1.3 初始化数据库

1. 在Supabase控制台中，进入 **SQL Editor**
2. 复制 `supabase/init.sql` 文件内容
3. 粘贴到SQL编辑器中并执行
4. 验证表是否创建成功

## 2. Vercel部署

### 2.1 安装Vercel CLI

```bash
npm install -g vercel
```

### 2.2 登录Vercel

```bash
vercel login
```

### 2.3 配置环境变量

在项目根目录创建 `.env.local` 文件：

```env
SUPABASE_URL=https://xxxxxxxxxxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
PIXIV_COOKIE=your_pixiv_cookie_here
PIXIV_USER_AGENT=Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0
PIXIV_REFERER=https://www.pixiv.net/artworks/112388359
MAX_ILLUSTRATIONS=1000
POPULARITY_THRESHOLD=0.22
REQUEST_DELAY_MIN=0
REQUEST_DELAY_MAX=1000
MAX_REQUESTS_PER_HEADER=300
```

### 2.4 构建项目

```bash
npm run build
```

### 2.5 部署到Vercel

```bash
vercel --prod
```

部署过程中会询问一些配置：
- 项目名称：`pixiv-crawler`
- 是否覆盖：选择 `Y`
- 环境变量：选择 `Y` 并确认

### 2.6 配置环境变量

在Vercel控制台中：

1. 进入项目设置
2. 选择 **Environment Variables**
3. 添加所有环境变量
4. 重新部署项目

## 3. 本地开发环境

### 3.1 安装依赖

```bash
npm install
```

### 3.2 配置环境变量

```bash
cp env.example .env
# 编辑 .env 文件，填入实际配置
```

### 3.3 启动开发服务器

```bash
npm run dev
```

### 3.4 测试API

```bash
# 测试服务状态
curl "http://localhost:3000/?action=status"

# 测试爬虫启动
curl -X POST "http://localhost:3000/" \
  -H "Content-Type: application/json" \
  -d '{"pid": "12345678", "targetNum": 100}'
```

## 4. 监控和维护

### 4.1 Vercel监控

- 在Vercel控制台查看函数执行日志
- 监控函数执行时间和错误率
- 设置告警通知

### 4.2 Supabase监控

- 监控数据库连接数
- 查看查询性能
- 设置存储空间告警

### 4.3 日志分析

```bash
# 查看Vercel函数日志
vercel logs

# 查看特定函数的日志
vercel logs --function=index
```

## 5. 故障排除

### 5.1 常见部署问题

#### 环境变量未生效
```bash
# 重新部署
vercel --prod
```

#### 数据库连接失败
- 检查Supabase URL和密钥
- 确认网络连接正常
- 验证数据库表是否创建

#### 函数超时
- 在 `vercel.json` 中调整 `maxDuration`
- 优化代码逻辑，减少执行时间

### 5.2 性能优化

#### 数据库优化
- 使用适当的索引
- 优化查询语句
- 考虑使用连接池

#### 函数优化
- 减少不必要的网络请求
- 使用缓存机制
- 异步处理耗时操作

## 6. 安全考虑

### 6.1 环境变量安全
- 不要在代码中硬编码敏感信息
- 使用Vercel的环境变量管理
- 定期轮换密钥

### 6.2 API安全
- 考虑添加API密钥验证
- 限制请求频率
- 监控异常访问

### 6.3 数据库安全
- 使用最小权限原则
- 定期备份数据
- 监控异常查询

## 7. 扩展部署

### 7.1 多环境部署

```bash
# 开发环境
vercel

# 预发布环境
vercel --target=preview

# 生产环境
vercel --prod
```

### 7.2 自定义域名

1. 在Vercel控制台添加自定义域名
2. 配置DNS记录
3. 配置SSL证书

### 7.3 CDN配置

- 在Vercel中启用CDN
- 配置缓存策略
- 优化静态资源

## 8. 备份和恢复

### 8.1 数据库备份

```bash
# 使用Supabase CLI备份
supabase db dump --db-url="postgresql://..."

# 或使用pg_dump
pg_dump "postgresql://..." > backup.sql
```

### 8.2 代码备份

```bash
# 推送到Git仓库
git add .
git commit -m "Backup before deployment"
git push origin main
```

### 8.3 环境配置备份

```bash
# 导出Vercel环境变量
vercel env ls > env_backup.txt
```

## 9. 更新和升级

### 9.1 代码更新

```bash
# 拉取最新代码
git pull origin main

# 安装依赖
npm install

# 构建和部署
npm run build
vercel --prod
```

### 9.2 依赖更新

```bash
# 检查过时依赖
npm outdated

# 更新依赖
npm update

# 测试后部署
npm run build
vercel --prod
```

## 10. 成本优化

### 10.1 Vercel成本
- 监控函数执行次数
- 优化函数执行时间
- 使用免费额度

### 10.2 Supabase成本
- 监控数据库使用量
- 优化查询性能
- 使用免费额度

## 联系支持

如果遇到部署问题：

1. 查看Vercel和Supabase官方文档
2. 在GitHub上提交Issue
3. 联系项目维护者 