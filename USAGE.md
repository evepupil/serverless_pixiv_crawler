# Pixiv爬虫使用说明

## 🚀 快速开始

### 1. 环境配置

在项目根目录下已经创建了 `.env` 文件，你需要配置以下关键参数：

#### 必需配置：
```env
# Supabase数据库配置（必需）
SUPABASE_URL=your_supabase_url_here
SUPABASE_ANON_KEY=your_supabase_anon_key_here

# Pixiv Cookie配置（必需）
PIXIV_COOKIE=your_pixiv_cookie_here
```

#### 可选配置：
```env
# 爬虫参数（可选，有默认值）
MAX_ILLUSTRATIONS=1000          # 最大爬取数量
POPULARITY_THRESHOLD=0.22       # 热度阈值
REQUEST_DELAY_MIN=0            # 最小请求延迟（毫秒）
REQUEST_DELAY_MAX=1000         # 最大请求延迟（毫秒）
MAX_REQUESTS_PER_HEADER=300    # 每个请求头最大请求数
```

### 2. 获取Pixiv Cookie

1. 打开浏览器，登录 [Pixiv](https://www.pixiv.net)
2. 按F12打开开发者工具
3. 切换到 Network 标签页
4. 刷新页面或访问任意插画页面
5. 找到请求头中的 `Cookie` 字段
6. 复制完整的Cookie值到 `.env` 文件中的 `PIXIV_COOKIE`

### 3. 配置Supabase数据库

1. 访问 [Supabase](https://supabase.com) 创建项目
2. 在项目设置中获取：
   - `SUPABASE_URL`：项目URL
   - `SUPABASE_ANON_KEY`：匿名密钥
3. 运行 `supabase/init.sql` 中的SQL语句创建数据表

### 4. 启动服务

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

服务启动后，访问 http://localhost:3000 打开Web控制台。

## 📱 使用Web界面

### 系统状态面板
- **服务状态**：显示服务运行状态
- **环境配置**：检查环境变量配置是否正确
- **统计信息**：显示数据库中的图片统计

### 爬虫控制
1. **单个PID爬取**：
   - 输入Pixiv插画ID（如：123456789）
   - 设置目标爬取数量
   - 点击"开始爬取"

2. **批量PID爬取**：
   - 每行输入一个Pixiv插画ID
   - 设置目标爬取数量
   - 点击"批量爬取"

### 实时日志
- 显示爬虫运行的实时日志
- 不同类型的日志用不同颜色区分
- 自动滚动到最新日志

## 🔧 故障排除

### 常见问题

1. **"环境变量配置异常"**
   - 检查 `.env` 文件是否存在
   - 确认 `SUPABASE_URL` 和 `SUPABASE_ANON_KEY` 已正确配置

2. **"Pixiv Cookie 未配置"**
   - 确认 `PIXIV_COOKIE` 已设置且不是默认值
   - 检查Cookie是否有效（可能需要重新获取）

3. **爬虫启动后无响应**
   - 检查网络连接
   - 确认Pixiv Cookie是否过期
   - 查看实时日志中的错误信息

4. **数据库连接失败**
   - 检查Supabase配置是否正确
   - 确认数据表已创建
   - 检查网络连接

### 日志说明

- 🟢 **INFO**：正常信息
- 🟡 **WARNING**：警告信息
- 🔴 **ERROR**：错误信息
- ✅ **SUCCESS**：成功信息

## 📊 数据说明

爬虫会收集以下数据：
- **PID**：Pixiv插画ID
- **标签**：插画标签
- **热度数据**：点赞数、收藏数、浏览数
- **热度评分**：计算得出的综合热度评分

只有热度评分超过阈值（默认0.22）的插画才会被保存到数据库。

## 🚀 部署到Vercel

1. 将代码推送到GitHub
2. 在Vercel中导入项目
3. 配置环境变量（与 `.env` 文件相同）
4. 部署完成后即可使用

## ⚠️ 注意事项

1. **请遵守Pixiv的使用条款**
2. **合理设置请求延迟，避免被封IP**
3. **定期更新Cookie以保持有效性**
4. **不要在公共仓库中提交 `.env` 文件**
5. **建议在低峰时段运行大量爬取任务**

## 📞 技术支持

如果遇到问题，请检查：
1. 环境变量配置
2. 网络连接
3. Pixiv Cookie有效性
4. Supabase数据库连接
5. 实时日志中的错误信息