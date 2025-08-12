# Pixiv Crawler - Cloudflare Workers 版本

## 🚀 **功能特性**

### **核心功能**
- ✅ **真实 Pixiv 爬虫** - 使用纯 Web API 进行爬取
- ✅ **HTML 解析** - 智能提取 PIDs 和排名信息
- ✅ **多种 PID 提取方法** - 主方法和备用方法确保成功率
- ✅ **排行榜爬取** - 日榜、周榜、月榜完整支持
- ✅ **首页推荐爬取** - 获取首页推荐作品
- ✅ **单 PID 爬取** - 从指定作品获取相关推荐
- ✅ **数据库写入** - 直接写入 Supabase 数据库
- ✅ **模块化架构** - 复用 Vercel 版本的代码结构

### **技术特点**
- 🌐 **纯 Web API** - 不依赖 Node.js 模块，完全兼容 Cloudflare Workers
- 🔒 **安全认证** - 支持 Supabase 新版 API Keys
- 📊 **实时统计** - 提供爬取状态和数据库统计信息
- 🚫 **智能过滤** - 只在成功爬取数据时写入数据库
- 📝 **详细日志** - 完整的爬取过程日志记录

## 🏗️ **架构设计**

### **目录结构**
```
cf_worker_pixiv_crawler/
├── src/
│   ├── types/           # 类型定义
│   ├── services/        # 爬虫服务
│   ├── database/        # 数据库服务
│   └── config/          # 配置服务
├── cf-worker.ts         # 主入口文件
├── wrangler.toml        # Cloudflare 配置
└── README.md            # 说明文档
```

### **模块说明**
- **`PixivCrawler`** - 核心爬虫逻辑，复用 Vercel 版本架构
- **`SupabaseService`** - 数据库操作，直接调用 REST API
- **类型系统** - 完整的 TypeScript 类型定义
- **配置管理** - 统一的配置和请求头管理

## 🔧 **API 端点**

### **GET 请求**
- `/?action=status` - 检查 API 状态和数据库统计
- `/?action=env-check` - 检查环境变量配置
- `/?action=daily` - 爬取日排行榜并保存到数据库
- `/?action=weekly` - 爬取周排行榜并保存到数据库
- `/?action=monthly` - 爬取月排行榜并保存到数据库
- `/?action=home` - 爬取首页推荐并保存到数据库

### **POST 请求**
- `/` - 从指定 PID 爬取相关作品并保存到数据库

## 📊 **响应格式**

### **成功响应示例**
```json
{
  "message": "Monthly ranking crawl completed and saved to database",
  "result": {
    "body": {
      "rankings": [
        {"pid": "123456", "rank": 1, "crawl_time": "2025-08-11T17:11:11.050Z"}
      ]
    },
    "error": false
  },
  "taskId": "monthly_1754932271050",
  "timestamp": "2025-08-11T17:11:11.050Z",
  "databaseWrite": "success",
  "rankingsCount": 1
}
```

### **失败响应示例**
```json
{
  "message": "Monthly ranking crawl failed - no data extracted",
  "result": {"body": {"rankings": []}, "error": true},
  "taskId": "monthly_1754932271050",
  "timestamp": "2025-08-11T17:11:11.050Z",
  "databaseWrite": "skipped",
  "error": "No rankings data to save"
}
```

## ⚙️ **环境变量**

### **必需变量**
- `SUPABASE_URL` - Supabase 项目 URL
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase 服务角色密钥
- `PIXIV_COOKIE` - Pixiv 网站 Cookie

### **可选变量**
- `PIXIV_REFERER` - Pixiv 请求引用页
- `PIXIV_USER_AGENT` - 自定义 User-Agent

## 🚀 **部署说明**

### **1. 安装依赖**
```bash
npm install
```

### **2. 配置环境变量**
在 `wrangler.toml` 中配置环境变量，或使用 `wrangler secret` 命令

### **3. 部署到 Cloudflare**
```bash
wrangler deploy
```

## 🔍 **调试和监控**

### **日志查看**
- 所有爬取过程都有详细的 console.log 输出
- 可在 Cloudflare Workers 控制台查看实时日志

### **状态检查**
- 使用 `/?action=status` 检查 API 状态
- 使用 `/?action=env-check` 验证环境配置

### **数据库验证**
- 响应中的 `databaseWrite` 字段显示数据库写入状态
- `rankingsCount` 显示实际爬取的数据量

## 🆚 **与 Vercel 版本对比**

| 特性 | Vercel 版本 | CF Workers 版本 |
|------|-------------|-----------------|
| 架构 | 单体文件 | 模块化分离 |
| 依赖 | Node.js 模块 | 纯 Web API |
| 部署 | Vercel | Cloudflare Workers |
| 前端 | HTML 界面 | API 接口 |
| 功能 | 完整功能 | 核心爬虫功能 |
| 数据库 | Supabase 客户端 | 直接 REST API |

## 🐛 **故障排除**

### **常见问题**
1. **爬取失败但显示成功** - 检查 `databaseWrite` 字段
2. **没有数据写入** - 查看 `rankingsCount` 是否为 0
3. **环境变量错误** - 使用 `/?action=env-check` 验证

### **调试步骤**
1. 检查 Cloudflare Workers 日志
2. 验证环境变量配置
3. 测试单个 API 端点
4. 检查 Supabase 数据库权限

## 📝 **更新日志**

### **v2.0.0** - 模块化重构
- ✅ 重构为模块化架构
- ✅ 复用 Vercel 版本代码结构
- ✅ 改进 PID 提取方法
- ✅ 添加备用提取策略
- ✅ 智能数据库写入控制
- ✅ 详细的响应状态信息

---

**注意**: 此版本完全兼容 Cloudflare Workers 环境，使用纯 Web API 实现，确保在 CF Workers 中稳定运行。