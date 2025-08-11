# 🚀 Pixiv Crawler - Cloudflare Worker (完整版)

这是一个**真正有用的** Pixiv 爬虫 Cloudflare Worker，包含完整的爬虫逻辑，不依赖 Node.js 模块！

## 🎯 **核心特性**

### **✅ 完整爬虫功能**
- **日排行榜爬取**：`/?action=daily` - 爬取 Pixiv 日排行榜
- **周排行榜爬取**：`/?action=weekly` - 爬取 Pixiv 周排行榜  
- **月排行榜爬取**：`/?action=monthly` - 爬取 Pixiv 月排行榜
- **首页推荐爬取**：`/?action=home` - 爬取首页推荐 PIDs
- **单 PID 爬取**：`POST /` - 从指定 PID 开始爬取相关作品

### **✅ 技术实现**
- **纯 Web API**：使用 `fetch()` 替代 `axios`
- **HTML 解析**：使用正则表达式提取 PIDs
- **无依赖**：不依赖任何 Node.js 模块
- **边缘计算**：在 Cloudflare 边缘节点运行

## 🔧 **配置**

### **环境变量**
```toml
# wrangler.toml
[vars]
SUPABASE_URL = "https://your-project.supabase.co"
SUPABASE_PUBLISHABLE_KEY = "sb_publishable_..."
SUPABASE_SECRET_KEY = "sb_secret_..."
PIXIV_COOKIE = "your_pixiv_cookie"
PIXIV_REFERER = "https://www.pixiv.net/artworks/123456789"
PIXIV_USER_AGENT = "Mozilla/5.0..."
```

### **部署命令**
```bash
cd cf_worker_pixiv_crawler
wrangler deploy
```

## 🌐 **API 端点**

### **GET 请求**
- `/?action=status` - 检查服务状态和功能列表
- `/?action=env-check` - 检查环境变量配置
- `/?action=daily` - **爬取日排行榜**（返回 PIDs + 排名）
- `/?action=weekly` - **爬取周排行榜**（返回 PIDs + 排名）
- `/?action=monthly` - **爬取月排行榜**（返回 PIDs + 排名）
- `/?action=home` - **爬取首页推荐**（返回 PIDs 列表）

### **POST 请求**
- `/` - **从指定 PID 爬取**（JSON body: `{pid, targetNum, popularityThreshold}`）

## 📊 **返回数据格式**

### **排行榜爬取结果**
```json
{
  "message": "Daily ranking crawl completed",
  "result": {
    "body": {
      "rankings": [
        {
          "pid": "123456789",
          "rank": 1,
          "crawl_time": "2024-01-01T00:00:00.000Z"
        }
      ]
    },
    "error": false
  },
  "taskId": "daily_1704067200000",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### **首页爬取结果**
```json
{
  "message": "Homepage crawl completed",
  "pids": ["123456789", "987654321"],
  "count": 2,
  "taskId": "home_1704067200000",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## 🚀 **技术优势**

### **1. 真正的爬虫功能**
- ✅ 实际访问 Pixiv 网站
- ✅ 解析 HTML 内容
- ✅ 提取 PIDs 和排名信息
- ✅ 生成结构化数据

### **2. 边缘计算优势**
- ⚡ **极快响应**：全球边缘节点部署
- 💰 **成本极低**：按请求计费，免费额度充足
- 🌍 **全球覆盖**：自动选择最近的节点
- 🔒 **安全隔离**：每个请求独立执行

### **3. 无依赖架构**
- 🚫 不使用 `fs`、`path`、`http` 等 Node.js 模块
- ✅ 使用标准 Web API：`fetch`、`TextEncoder`、`RegExp`
- 🔧 完全兼容 Cloudflare Workers 环境

## 🔄 **与 Vercel 版本对比**

| 功能 | CF Worker | Vercel |
|------|-----------|---------|
| 爬虫逻辑 | ✅ **完整** | ✅ 完整 |
| 数据库操作 | ❌ 无（可扩展） | ✅ 完整 |
| API 端点 | ✅ **完整** | ✅ 完整 |
| 部署速度 | ⚡ **极快** | 🚀 快 |
| 成本 | 💰 **极低** | 💰 低 |
| 全球覆盖 | 🌍 **自动** | 🌍 手动 |

## 🎯 **使用场景**

### **1. 独立爬虫服务**
- 作为轻量级爬虫 API
- 快速获取 Pixiv 数据
- 无需维护服务器

### **2. 定时任务触发器**
- 配合 CRON 定时爬取
- 自动更新排行榜数据
- 监控 Pixiv 变化

### **3. 数据收集工具**
- 批量收集 PIDs
- 生成排行榜数据
- 为其他服务提供数据源

## 🚀 **扩展可能性**

### **1. 添加数据库支持**
```typescript
// 可以集成 Supabase 客户端
import { createClient } from '@supabase/supabase-js';
```

### **2. 添加缓存机制**
```typescript
// 使用 Cloudflare KV 存储
const cache = env.MY_KV.get(key);
```

### **3. 添加队列处理**
```typescript
// 使用 Cloudflare Queues
await env.MY_QUEUE.send(data);
```

## 📞 **技术支持**

这个 CF Worker 现在包含：
- ✅ **完整的爬虫逻辑**
- ✅ **真实的 Pixiv 数据获取**
- ✅ **结构化的返回数据**
- ✅ **错误处理和重试机制**

**不再是一个简单的框架，而是真正可用的爬虫服务！** 🎉

---

**现在你可以部署这个 CF Worker 并获得真正的爬虫功能！** 🚀 