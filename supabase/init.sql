-- 创建数据库表结构
-- 注意：Supabase使用PostgreSQL，所以语法与MySQL略有不同

-- 创建Pic表
CREATE TABLE IF NOT EXISTS pic (
    pid VARCHAR(255) PRIMARY KEY,
    title TEXT, -- 插画标题
    author_id VARCHAR(255), -- 作者ID
    author_name VARCHAR(255), -- 作者名称
    download_time VARCHAR(255),
    tag TEXT,
    good INTEGER,
    star INTEGER,
    view INTEGER,
    image_path VARCHAR(255),
    image_url VARCHAR(255),
    popularity DECIMAL(10,4),
    upload_time VARCHAR(255),
    wx_url VARCHAR(255),
    wx_name VARCHAR(255),
    unfit BOOLEAN DEFAULT FALSE,
    size BIGINT, -- 图片文件大小（字节）
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_pic_tags ON pic USING GIN(to_tsvector('english', tag));
CREATE INDEX IF NOT EXISTS idx_pic_popularity ON pic(popularity DESC);
CREATE INDEX IF NOT EXISTS idx_pic_download_time ON pic(download_time);
CREATE INDEX IF NOT EXISTS idx_pic_wx_name ON pic(wx_name);
CREATE INDEX IF NOT EXISTS idx_pic_unfit ON pic(unfit);
CREATE INDEX IF NOT EXISTS idx_pic_author_id ON pic(author_id); -- 作者ID索引
CREATE INDEX IF NOT EXISTS idx_pic_author_name ON pic(author_name); -- 作者名称索引
CREATE INDEX IF NOT EXISTS idx_pic_title ON pic USING GIN(to_tsvector('english', title)); -- 标题全文搜索索引

-- 创建全文搜索索引
CREATE INDEX IF NOT EXISTS idx_pic_tag_fulltext ON pic USING GIN(to_tsvector('english', tag));

-- 创建更新时间触发器
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 为Pic表添加更新时间触发器
CREATE TRIGGER update_pic_updated_at BEFORE UPDATE ON pic FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 创建视图用于统计
CREATE OR REPLACE VIEW pic_stats AS
SELECT 
    COUNT(*) as total_pics,
    COUNT(CASE WHEN image_path IS NOT NULL AND image_path != '' THEN 1 END) as downloaded_pics,
    COUNT(CASE WHEN wx_name IS NOT NULL AND wx_name != '' THEN 1 END) as uploaded_pics,
    COUNT(DISTINCT author_id) as unique_authors,
    AVG(popularity) as avg_popularity,
    MAX(popularity) as max_popularity,
    MIN(popularity) as min_popularity
FROM pic;

-- 创建函数用于标签搜索
CREATE OR REPLACE FUNCTION search_pics_by_tags(search_tags TEXT[], limit_count INTEGER DEFAULT 10)
RETURNS TABLE(pid VARCHAR, title TEXT, author_name VARCHAR, tag TEXT, popularity DECIMAL, good INTEGER, star INTEGER, view INTEGER) AS $$
BEGIN
    RETURN QUERY
    SELECT p.pid, p.title, p.author_name, p.tag, p.popularity, p.good, p.star, p.view
    FROM pic p
    WHERE p.unfit = FALSE
    AND (
        SELECT COUNT(*)
        FROM unnest(search_tags) tag
        WHERE p.tag ILIKE '%' || tag || '%'
    ) = array_length(search_tags, 1)
    ORDER BY p.popularity DESC
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- 创建函数用于随机获取PID
CREATE OR REPLACE FUNCTION get_random_pids(limit_count INTEGER DEFAULT 10)
RETURNS TABLE(pid VARCHAR) AS $$
BEGIN
    RETURN QUERY
    SELECT p.pid
    FROM pic p
    WHERE p.unfit = FALSE
    ORDER BY RANDOM()
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- 创建pic_task表用于跟踪爬取任务状态
CREATE TABLE IF NOT EXISTS pic_task (
    pid VARCHAR(255) PRIMARY KEY,
    -- 爬取状态标志位
    illust_recommend_crawled BOOLEAN DEFAULT FALSE, -- 是否已爬取插画推荐
    author_recommend_crawled BOOLEAN DEFAULT FALSE, -- 是否已爬取作者推荐
    detail_info_crawled BOOLEAN DEFAULT FALSE, -- 是否已爬取详细信息
    -- 时间戳记录
    illust_recommend_time TIMESTAMP WITH TIME ZONE, -- 插画推荐爬取时间
    author_recommend_time TIMESTAMP WITH TIME ZONE, -- 作者推荐爬取时间
    detail_info_time TIMESTAMP WITH TIME ZONE, -- 详细信息爬取时间
    -- 统计信息
    illust_recommend_count INTEGER DEFAULT 0, -- 获取到的插画推荐数量
    author_recommend_count INTEGER DEFAULT 0, -- 获取到的作者推荐数量
    -- 元数据
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 为pic_task表创建索引
CREATE INDEX IF NOT EXISTS idx_pic_task_illust_recommend ON pic_task(illust_recommend_crawled);
CREATE INDEX IF NOT EXISTS idx_pic_task_author_recommend ON pic_task(author_recommend_crawled);
CREATE INDEX IF NOT EXISTS idx_pic_task_detail_info ON pic_task(detail_info_crawled);
CREATE INDEX IF NOT EXISTS idx_pic_task_created_at ON pic_task(created_at);

-- 为pic_task表添加更新时间触发器
CREATE TRIGGER update_pic_task_updated_at BEFORE UPDATE ON pic_task FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 创建排行类型枚举（daily, weekly, monthly）
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rank_type') THEN
        CREATE TYPE rank_type AS ENUM ('daily', 'weekly', 'monthly');
    END IF;
END$$;

-- 创建排行榜表
CREATE TABLE IF NOT EXISTS ranking (
    id BIGSERIAL PRIMARY KEY,
    pid VARCHAR(255) NOT NULL,
    rank INTEGER NOT NULL CHECK (rank > 0),
    rank_type rank_type NOT NULL,
    -- 日榜：当日日期；周/月榜：可记录周期开始日期
    rank_date DATE NOT NULL,
    crawl_time TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 如果历史上存在与 pic 的外键约束，移除之，确保 ranking 与 pic 无关联
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'fk_ranking_pic' AND table_name = 'ranking'
    ) THEN
        ALTER TABLE ranking DROP CONSTRAINT fk_ranking_pic;
    END IF;
END$$;

-- 唯一约束：同一类型 + 日期 同一 pid 只保留一条
CREATE UNIQUE INDEX IF NOT EXISTS uq_ranking_unique ON ranking(rank_type, rank_date, pid);

-- 常用查询索引
CREATE INDEX IF NOT EXISTS idx_ranking_type_date_rank ON ranking(rank_type, rank_date, rank);
CREATE INDEX IF NOT EXISTS idx_ranking_pid ON ranking(pid);

-- 为Ranking表添加更新时间触发器
CREATE TRIGGER update_ranking_updated_at BEFORE UPDATE ON ranking FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 创建函数用于获取随机图片
CREATE OR REPLACE FUNCTION get_random_pics_by_tags(search_tags TEXT[], limit_count INTEGER DEFAULT 6)
RETURNS TABLE(pid VARCHAR, title TEXT, author_name VARCHAR, tag TEXT, popularity DECIMAL) AS $$
BEGIN
    RETURN QUERY
    SELECT p.pid, p.title, p.author_name, p.tag, p.popularity
    FROM pic p
    WHERE p.unfit = FALSE
    AND (
        SELECT COUNT(*)
        FROM unnest(search_tags) tag
        WHERE p.tag ILIKE '%' || tag || '%'
    ) = array_length(search_tags, 1)
    ORDER BY RANDOM()
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;