-- ============================================
-- Pixiv爬虫 SQLite 数据库表结构
-- 适用于 Turso (libSQL) 数据库
-- ============================================

-- pic 表：存储插画信息
CREATE TABLE IF NOT EXISTS pic (
    pid TEXT PRIMARY KEY,           -- Pixiv 作品ID (主键)
    title TEXT,                     -- 插画标题
    author_id TEXT,                 -- 作者ID
    author_name TEXT,               -- 作者名称
    tag TEXT DEFAULT '',            -- 标签列表 (JSON格式)
    good INTEGER DEFAULT 0,         -- 点赞数
    star INTEGER DEFAULT 0,         -- 收藏数
    view INTEGER DEFAULT 0,         -- 浏览数
    popularity REAL DEFAULT 0,      -- 热度评分
    image_path TEXT DEFAULT '',     -- 存储路径 (B2)
    image_url TEXT DEFAULT '',      -- 原始图片URL
    download_time TEXT,             -- 下载时间
    upload_time TEXT,               -- 上传时间
    wx_url TEXT,                    -- 微信图片URL
    wx_name TEXT,                   -- 微信文件名
    unfit INTEGER DEFAULT 0,        -- 是否不适宜 (0=适宜, 1=不适宜)
    size INTEGER,                   -- 图片文件大小 (字节)
    created_at TEXT,                -- 创建时间
    updated_at TEXT                 -- 更新时间
);

-- pic 表索引
CREATE INDEX IF NOT EXISTS idx_pic_popularity ON pic(popularity DESC);
CREATE INDEX IF NOT EXISTS idx_pic_author_id ON pic(author_id);
CREATE INDEX IF NOT EXISTS idx_pic_download_time ON pic(download_time);
CREATE INDEX IF NOT EXISTS idx_pic_unfit ON pic(unfit);

-- pic_task 表：存储爬取任务状态
CREATE TABLE IF NOT EXISTS pic_task (
    pid TEXT PRIMARY KEY,                       -- Pixiv 作品ID (主键)
    illust_recommend_crawled INTEGER DEFAULT 0, -- 插画推荐是否已爬取 (0/1)
    illust_recommend_time TEXT,                 -- 插画推荐爬取时间
    illust_recommend_count INTEGER DEFAULT 0,   -- 插画推荐获取数量
    author_recommend_crawled INTEGER DEFAULT 0, -- 作者推荐是否已爬取 (0/1)
    author_recommend_time TEXT,                 -- 作者推荐爬取时间
    author_recommend_count INTEGER DEFAULT 0,   -- 作者推荐获取数量
    detail_info_crawled INTEGER DEFAULT 0,      -- 详细信息是否已爬取 (0/1)
    detail_info_time TEXT,                      -- 详细信息爬取时间
    created_at TEXT,                            -- 创建时间
    updated_at TEXT                             -- 更新时间
);

-- pic_task 表索引
CREATE INDEX IF NOT EXISTS idx_pic_task_illust_recommend ON pic_task(illust_recommend_crawled);
CREATE INDEX IF NOT EXISTS idx_pic_task_author_recommend ON pic_task(author_recommend_crawled);
CREATE INDEX IF NOT EXISTS idx_pic_task_detail_info ON pic_task(detail_info_crawled);

-- ranking 表：存储排行榜数据
CREATE TABLE IF NOT EXISTS ranking (
    id INTEGER PRIMARY KEY AUTOINCREMENT,       -- 自增ID
    pid TEXT NOT NULL,                          -- Pixiv 作品ID
    rank INTEGER NOT NULL,                      -- 排名
    rank_type TEXT NOT NULL,                    -- 排行类型 (daily/weekly/monthly)
    rank_date TEXT NOT NULL,                    -- 排行日期 (YYYY-MM-DD)
    crawl_time TEXT NOT NULL,                   -- 爬取时间
    UNIQUE(rank_type, rank_date, pid)           -- 唯一约束
);

-- ranking 表索引
CREATE INDEX IF NOT EXISTS idx_ranking_type_date ON ranking(rank_type, rank_date);
CREATE INDEX IF NOT EXISTS idx_ranking_pid ON ranking(pid);
