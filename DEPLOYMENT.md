# Pixiv爬虫 Serverless 部署指南

## 部署到 Vercel

### 1. 环境准备

确保你的项目已经正确构建：
```bash
npm install
npm run build
```

### 2. 环境变量配置

**重要：这是解决404错误的关键步骤！**

在 Vercel 项目设置中添加以下环境变量：

#### 必需的环境变量：
- `SUPABASE_URL`: 你的 Supabase 项目 URL
- `SUPABASE_ANON_KEY`: 你的 Supabase 匿名密钥

#### 可选的环境变量：
- `PIXIV_USER_AGENT`: Pixiv 请求的 User-Agent
- `PIXIV_COOKIE`: Pixiv 登录 Cookie
- `PIXIV_REFERER`: Pixiv 请求的 Referer

### 3. 部署步骤

1. 安装 Vercel CLI：
```bash
npm i -g vercel
```

2. 登录 Vercel：
```bash
vercel login
```

3. 部署项目：
```bash
vercel --prod
```

### 4. 常见问题解决

#### 问题：网站显示 404 错误

**原因分析：**
1. 环境变量未配置：缺少 Supabase 配置导致应用启动失败
2. 数据库连接失败：Supabase 连接问题
3. 构建文件缺失：`dist` 目录未生成

**解决方案：**

1. **检查环境变量**：
   - 登录 Vercel 控制台
   - 进入项目设置 → Environment Variables
   - 添加 `SUPABASE_URL` 和 `SUPABASE_ANON_KEY`

2. **验证环境变量**：
   - 访问你的网站
   - 查看"环境配置"状态
   - 如果显示"缺失"，说明环境变量未正确配置

3. **重新部署**：
   ```bash
   vercel --prod
   ```

#### 问题：Vercel 部署错误

如果遇到 `functions` 和 `builds` 冲突错误：
- 确保 `vercel.json` 中只使用 `builds` 配置
- 不要同时使用 `functions` 属性

### 5. 验证部署

部署成功后，访问你的网站应该能看到：
- Pixiv爬虫控制台界面
- 系统状态显示"运行中"
- 环境配置显示"正常"

如果环境配置显示"缺失"，请检查环境变量设置。

### 6. 本地测试

在部署前，可以在本地测试：
```bash
npm run dev
```

访问 `http://localhost:3000` 查看效果。

### 7. 故障排除

#### 检查日志
在 Vercel 控制台查看函数日志，寻找错误信息。

#### 环境变量测试
使用环境变量检查端点：`/?action=env-check`

#### 数据库连接测试
确保 Supabase 项目正常运行，数据库表已创建。

---

## 注意事项

1. **环境变量安全**：不要在代码中硬编码敏感信息
2. **数据库权限**：确保 Supabase 匿名密钥有适当的权限
3. **请求限制**：注意 Vercel 的函数执行时间限制
4. **成本控制**：监控 Supabase 和 Vercel 的使用量

## 技术支持

如果遇到问题，请检查：
1. 环境变量配置
2. Supabase 项目状态
3. Vercel 部署日志
4. 浏览器控制台错误 