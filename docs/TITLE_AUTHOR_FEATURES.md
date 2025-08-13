# 标题和作者功能说明

## 概述

本次更新为Pixiv爬虫添加了标题和作者信息的爬取和存储功能。现在爬虫会额外获取每张插画的标题、作者ID和作者名称，并将这些信息存储到数据库中。

## 新增字段

### 数据库字段

在 `pic` 表中新增了以下字段：

- `title` (TEXT): 插画标题
- `author_id` (VARCHAR(255)): 作者ID
- `author_name` (VARCHAR(255)): 作者名称

### 类型定义

在 `DatabasePic` 接口中新增了对应的可选字段：

```typescript
export interface DatabasePic {
  pid: string;
  title?: string; // 插画标题
  author_id?: string; // 作者ID
  author_name?: string; // 作者名称
  // ... 其他字段
}
```

## 新增工具函数

在 `pixiv-utils.ts` 中新增了以下函数：

- `getIllustTitle(infoJson: PixivIllustInfo): string | null`: 获取插画标题
- `getIllustAuthorId(infoJson: PixivIllustInfo): string | null`: 获取作者ID
- `getIllustAuthorName(infoJson: PixivIllustInfo): string | null`: 获取作者名称

## 数据库迁移

### 新安装

如果是新安装，直接运行 `supabase/init.sql` 即可，该文件已经包含了新的字段定义。

### 现有数据库升级

对于现有的数据库，需要运行迁移脚本：

```sql
-- 在Supabase SQL编辑器中运行
\i supabase/migration_add_title_author.sql
```

或者直接复制迁移脚本内容到SQL编辑器中执行。

## 新增数据库函数

### 1. 根据作者ID获取图片

```sql
SELECT * FROM get_pics_by_author('12345', 20);
```

### 2. 根据作者名称搜索图片

```sql
SELECT * FROM search_pics_by_author_name('画师名称', 20);
```

### 3. 根据标题搜索图片

```sql
SELECT * FROM search_pics_by_title('标题关键词', 20);
```

## 爬虫行为变化

### 数据获取

现在爬虫在获取插画信息时会额外获取：

1. **标题**: 从 `info.body.title` 获取
2. **作者ID**: 从 `info.body.userId` 获取  
3. **作者名称**: 从 `info.body.userName` 获取

### 日志输出

爬虫会输出新增字段的信息：

```
title:插画标题
author_id:12345, author_name:画师名称
```

### 数据库存储

所有新字段都会被存储到数据库中，如果某个字段为空，则存储为 `undefined`。

## 下载器优化

### 画师名称获取方法更新

`PixivDownloader` 类中的 `getArtistName` 方法也已更新，现在使用相同的API接口来获取画师名称：

- **之前**: 解析HTML页面，使用cheerio查找meta标签
- **现在**: 直接调用 `https://www.pixiv.net/ajax/illust/${pid}` API接口

这种方法的优势：
- **更高效**: 直接获取JSON数据，无需解析HTML
- **更可靠**: 避免HTML结构变化导致的解析失败
- **更统一**: 与爬虫使用相同的数据源
- **更快速**: 减少了数据传输量和解析时间

## 性能优化

### 索引

为新字段创建了以下索引：

- `idx_pic_author_id`: 作者ID索引
- `idx_pic_author_name`: 作者名称索引  
- `idx_pic_title`: 标题全文搜索索引

### 统计视图

更新了 `pic_stats` 视图，新增了 `unique_authors` 字段来统计唯一作者数量。

## 使用示例

### 前端查询

```typescript
// 根据作者名称搜索
const authorPics = await supabase
  .rpc('search_pics_by_author_name', { 
    author_name_pattern: '画师名称', 
    limit_count: 20 
  });

// 根据标题搜索
const titlePics = await supabase
  .rpc('search_pics_by_title', { 
    title_pattern: '关键词', 
    limit_count: 20 
  });
```

### 数据分析

```sql
-- 统计每个作者的插画数量
SELECT author_name, COUNT(*) as pic_count 
FROM pic 
WHERE author_name IS NOT NULL 
GROUP BY author_name 
ORDER BY pic_count DESC;

-- 查找标题包含特定关键词的插画
SELECT pid, title, author_name, popularity 
FROM pic 
WHERE title ILIKE '%关键词%' 
ORDER BY popularity DESC;
```

## 注意事项

1. **字段可选性**: 新增字段都是可选的，因为某些插画可能没有完整的元数据
2. **向后兼容**: 现有代码无需修改，新字段会自动填充
3. **性能影响**: 新增字段和索引会略微增加存储空间和查询时间，但提供了更丰富的搜索功能
4. **数据完整性**: 建议定期检查数据质量，确保重要字段的完整性

## 故障排除

### 字段不存在错误

如果遇到字段不存在的错误，请确保已经运行了迁移脚本。

### 索引创建失败

如果索引创建失败，检查是否有足够的权限，或者手动创建索引。

### 数据为空

如果某些记录的标题或作者信息为空，这是正常现象，可能是因为：
- 插画已被删除
- 作者账户已被封禁
- API返回的数据不完整

## 未来计划

1. **批量更新**: 为现有记录批量填充标题和作者信息
2. **作者统计**: 添加作者相关的统计和分析功能
3. **标签关联**: 将作者信息与标签系统关联
4. **搜索优化**: 优化全文搜索的性能和准确性 