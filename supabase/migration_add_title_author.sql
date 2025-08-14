-- 迁移脚本：为现有的pic表添加title、author_id和author_name字段
-- 如果字段不存在则添加，如果存在则跳过

-- 添加title字段
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pic' AND column_name = 'title') THEN
        ALTER TABLE pic ADD COLUMN title TEXT;
        RAISE NOTICE 'Added title column to pic table';
    ELSE
        RAISE NOTICE 'title column already exists in pic table';
    END IF;
END$$;

-- 添加author_id字段
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pic' AND column_name = 'author_id') THEN
        ALTER TABLE pic ADD COLUMN author_id VARCHAR(255);
        RAISE NOTICE 'Added author_id column to pic table';
    ELSE
        RAISE NOTICE 'author_id column already exists in pic table';
    END IF;
END$$;

-- 添加author_name字段
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pic' AND column_name = 'author_name') THEN
        ALTER TABLE pic ADD COLUMN author_name VARCHAR(255);
        RAISE NOTICE 'Added author_name column to pic table';
    ELSE
        RAISE NOTICE 'author_name column already exists in pic table';
    END IF;
END$$;

-- 创建新字段的索引（如果不存在）
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_pic_author_id') THEN
        CREATE INDEX idx_pic_author_id ON pic(author_id);
        RAISE NOTICE 'Created index on author_id column';
    ELSE
        RAISE NOTICE 'Index on author_id column already exists';
    END IF;
END$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_pic_author_name') THEN
        CREATE INDEX idx_pic_author_name ON pic(author_name);
        RAISE NOTICE 'Created index on author_name column';
    ELSE
        RAISE NOTICE 'Index on author_name column already exists';
    END IF;
END$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_pic_title') THEN
        CREATE INDEX idx_pic_title ON pic USING GIN(to_tsvector('english', title));
        RAISE NOTICE 'Created fulltext index on title column';
    ELSE
        RAISE NOTICE 'Fulltext index on title column already exists';
    END IF;
END$$;

-- 更新统计视图
DROP VIEW IF EXISTS pic_stats;
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

-- 删除现有函数（如果存在），然后重新创建
-- 注意：必须先删除函数，因为返回类型发生了变化

-- 删除并重新创建标签搜索函数
DROP FUNCTION IF EXISTS search_pics_by_tags(text[], integer);
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

-- 删除并重新创建随机图片函数
DROP FUNCTION IF EXISTS get_random_pics_by_tags(text[], integer);
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

-- 创建新的函数：根据作者ID获取图片
CREATE OR REPLACE FUNCTION get_pics_by_author(author_id_param VARCHAR, limit_count INTEGER DEFAULT 20)
RETURNS TABLE(pid VARCHAR, title TEXT, tag TEXT, popularity DECIMAL, good INTEGER, star INTEGER, view INTEGER) AS $$
BEGIN
    RETURN QUERY
    SELECT p.pid, p.title, p.tag, p.popularity, p.good, p.star, p.view
    FROM pic p
    WHERE p.author_id = author_id_param AND p.unfit = FALSE
    ORDER BY p.popularity DESC
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- 创建新的函数：根据作者名称搜索图片
CREATE OR REPLACE FUNCTION search_pics_by_author_name(author_name_pattern VARCHAR, limit_count INTEGER DEFAULT 20)
RETURNS TABLE(pid VARCHAR, title TEXT, tag TEXT, popularity DECIMAL, good INTEGER, star INTEGER, view INTEGER) AS $$
BEGIN
    RETURN QUERY
    SELECT p.pid, p.title, p.tag, p.popularity, p.good, p.star, p.view
    FROM pic p
    WHERE p.author_name ILIKE '%' || author_name_pattern || '%' AND p.unfit = FALSE
    ORDER BY p.popularity DESC
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- 创建新的函数：根据标题搜索图片
CREATE OR REPLACE FUNCTION search_pics_by_title(title_pattern VARCHAR, limit_count INTEGER DEFAULT 20)
RETURNS TABLE(pid VARCHAR, title TEXT, author_name VARCHAR, tag TEXT, popularity DECIMAL, good INTEGER, star INTEGER, view INTEGER) AS $$
BEGIN
    RETURN QUERY
    SELECT p.pid, p.title, p.author_name, p.tag, p.popularity, p.good, p.star, p.view
    FROM pic p
    WHERE p.title ILIKE '%' || title_pattern || '%' AND p.unfit = FALSE
    ORDER BY p.popularity DESC
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

RAISE NOTICE 'Migration completed successfully!'; 