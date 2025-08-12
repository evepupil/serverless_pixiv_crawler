# Cloudflare R2 配置指南

## 概述

本指南将帮助您配置 Cloudflare R2 存储，以便使用 Pixiv 爬虫的图片下载功能。

## 1. 创建 Cloudflare 账户

1. 访问 [Cloudflare官网](https://www.cloudflare.com/)
2. 注册或登录您的账户
3. 完成账户验证

## 2. 获取 Account ID

1. 登录 Cloudflare 控制台
2. 在右侧边栏找到您的 **Account ID**
3. 复制这个 ID，格式类似：`a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6`

## 3. 创建 R2 存储桶

1. 在 Cloudflare 控制台中，点击 **R2 Object Storage**
2. 点击 **Create bucket**
3. 输入存储桶名称（例如：`pixiv-images`）
4. 选择区域（建议选择离您最近的区域）
5. 点击 **Create bucket**

## 4. 创建 API Token

1. 在 Cloudflare 控制台中，点击 **My Profile** → **API Tokens**
2. 点击 **Create Token**
3. 选择 **Custom token** 模板
4. 配置权限：
   - **Account Resources**: 选择您的账户
   - **Zone Resources**: 选择 **All zones**
   - **Permissions**:
     - **Object Read**: 选择 **Edit**
     - **Object Write**: 选择 **Edit**
5. 点击 **Continue to summary**
6. 点击 **Create Token**
7. **重要**: 复制并保存 Token，它只会显示一次

## 5. 获取 Access Key ID 和 Secret Access Key

1. 在 R2 页面中，点击 **Manage R2 API tokens**
2. 点击 **Create API token**
3. 选择 **Custom token**
4. 配置权限：
   - **Permissions**: 选择 **Object Read & Write**
   - **Bucket**: 选择您创建的存储桶
5. 点击 **Create API Token**
6. 复制 **Access Key ID** 和 **Secret Access Key**

## 6. 配置环境变量

在您的 `.env` 文件中添加以下配置：

```env
# Cloudflare R2配置
CLOUDFLARE_ACCOUNT_ID=your_account_id_here
CLOUDFLARE_ACCESS_KEY_ID=your_access_key_id_here
CLOUDFLARE_SECRET_ACCESS_KEY=your_secret_access_key_here
CLOUDFLARE_BUCKET_NAME=your_bucket_name_here
CLOUDFLARE_REGION=auto
```

## 7. 配置存储桶权限（可选）

如果您希望图片可以公开访问，需要配置存储桶的公共访问权限：

1. 在 R2 存储桶页面，点击 **Settings**
2. 在 **Public URL** 部分，点击 **Enable**
3. 选择 **Public** 访问权限
4. 保存设置

## 8. 验证配置

使用测试脚本验证配置是否正确：

```bash
# 安装依赖
npm install

# 运行测试
npm run test:download 123456789
```

## 常见问题

### Q: 如何获取 Account ID？
A: 在 Cloudflare 控制台右侧边栏可以看到您的 Account ID，或者在 R2 页面的 URL 中也能找到。

### Q: 存储桶名称有什么要求？
A: 存储桶名称必须：
- 长度在 3-63 个字符之间
- 只能包含小写字母、数字和连字符
- 不能以连字符开头或结尾
- 不能包含连续的两个连字符

### Q: 如何查看已上传的文件？
A: 在 R2 控制台中，点击您的存储桶，可以看到所有上传的文件。文件会按照 `pixiv/{pid}/{filename}` 的路径存储。

### Q: 如何删除不需要的文件？
A: 在 R2 控制台中，选择文件后点击删除按钮，或者使用 R2 API 进行批量删除。

### Q: 存储费用如何计算？
A: Cloudflare R2 的定价基于：
- 存储空间使用量
- API 请求次数
- 数据传输量

详细定价请参考 [Cloudflare R2 定价页面](https://www.cloudflare.com/products/r2-object-storage/)。

## 安全建议

1. **定期轮换 API Token**: 建议每 90 天更新一次 API Token
2. **限制权限**: 只授予必要的权限，避免过度授权
3. **监控使用量**: 定期检查存储使用情况和费用
4. **备份重要数据**: 定期备份重要的图片数据

## 故障排除

### 错误：Access Denied
- 检查 API Token 权限是否正确
- 确认存储桶名称是否正确
- 验证 Account ID 是否正确

### 错误：Bucket Not Found
- 确认存储桶名称拼写正确
- 检查存储桶是否在正确的区域
- 验证 Account ID 是否匹配

### 错误：Invalid Credentials
- 检查 Access Key ID 和 Secret Access Key 是否正确
- 确认 API Token 是否已过期
- 验证账户状态是否正常

## 相关链接

- [Cloudflare R2 官方文档](https://developers.cloudflare.com/r2/)
- [R2 API 参考](https://developers.cloudflare.com/r2/api/)
- [R2 定价](https://www.cloudflare.com/products/r2-object-storage/)
- [R2 最佳实践](https://developers.cloudflare.com/r2/best-practices/) 