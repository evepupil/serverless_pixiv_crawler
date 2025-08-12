-- 创建数据库表结构
-- 注意：Supabase使用PostgreSQL，所以语法与MySQL略有不同

-- 创建Pic表
CREATE TABLE IF NOT EXISTS pic (
    pid VARCHAR(255) PRIMARY KEY,
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
    AVG(popularity) as avg_popularity,
    MAX(popularity) as max_popularity,
    MIN(popularity) as min_popularity
FROM pic;

-- 创建函数用于标签搜索
CREATE OR REPLACE FUNCTION search_pics_by_tags(search_tags TEXT[], limit_count INTEGER DEFAULT 10)
RETURNS TABLE(pid VARCHAR, tag TEXT, popularity DECIMAL, good INTEGER, star INTEGER, view INTEGER) AS $$
BEGIN
    RETURN QUERY
    SELECT p.pid, p.tag, p.popularity, p.good, p.star, p.view
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
RETURNS TABLE(pid VARCHAR, tag TEXT, popularity DECIMAL) AS $$
BEGIN
    RETURN QUERY
    SELECT p.pid, p.tag, p.popularity
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