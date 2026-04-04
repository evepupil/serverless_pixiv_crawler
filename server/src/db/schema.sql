-- Pixiv crawler schema for Turso/libSQL

CREATE TABLE IF NOT EXISTS pic (
    pid TEXT PRIMARY KEY,
    title TEXT,
    author_id TEXT,
    author_name TEXT,
    tag TEXT DEFAULT '',
    good INTEGER DEFAULT 0,
    star INTEGER DEFAULT 0,
    view INTEGER DEFAULT 0,
    popularity REAL DEFAULT 0,
    image_path TEXT DEFAULT '',
    image_url TEXT DEFAULT '',
    download_time TEXT,
    upload_time TEXT,
    wx_url TEXT,
    wx_name TEXT,
    unfit INTEGER DEFAULT 0,
    size INTEGER,
    created_at TEXT,
    updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_pic_popularity ON pic(popularity DESC);
CREATE INDEX IF NOT EXISTS idx_pic_author_id ON pic(author_id);
CREATE INDEX IF NOT EXISTS idx_pic_download_time ON pic(download_time);
CREATE INDEX IF NOT EXISTS idx_pic_unfit ON pic(unfit);

CREATE TABLE IF NOT EXISTS pic_task (
    pid TEXT PRIMARY KEY,
    illust_recommend_crawled INTEGER DEFAULT 0,
    illust_recommend_time TEXT,
    illust_recommend_count INTEGER DEFAULT 0,
    author_recommend_crawled INTEGER DEFAULT 0,
    author_recommend_time TEXT,
    author_recommend_count INTEGER DEFAULT 0,
    detail_info_crawled INTEGER DEFAULT 0,
    detail_info_time TEXT,
    priority INTEGER DEFAULT 0,
    task_source_type TEXT DEFAULT 'unknown',
    task_source_key TEXT,
    source_recent_at TEXT,
    attempt_count INTEGER DEFAULT 0,
    next_retry_at TEXT,
    last_error TEXT,
    created_at TEXT,
    updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_pic_task_illust_recommend ON pic_task(illust_recommend_crawled);
CREATE INDEX IF NOT EXISTS idx_pic_task_author_recommend ON pic_task(author_recommend_crawled);
CREATE INDEX IF NOT EXISTS idx_pic_task_detail_info ON pic_task(detail_info_crawled);
CREATE INDEX IF NOT EXISTS idx_pic_task_priority ON pic_task(priority);
CREATE INDEX IF NOT EXISTS idx_pic_task_source_recent ON pic_task(task_source_type, source_recent_at);

CREATE TABLE IF NOT EXISTS ranking (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pid TEXT NOT NULL,
    rank INTEGER NOT NULL,
    rank_type TEXT NOT NULL,
    rank_date TEXT NOT NULL,
    crawl_time TEXT NOT NULL,
    UNIQUE(rank_type, rank_date, pid)
);

CREATE INDEX IF NOT EXISTS idx_ranking_type_date ON ranking(rank_type, rank_date);
CREATE INDEX IF NOT EXISTS idx_ranking_pid ON ranking(pid);

CREATE TABLE IF NOT EXISTS download_job (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pid TEXT NOT NULL,
    job_type TEXT NOT NULL,
    requested_sizes TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'pending',
    priority INTEGER DEFAULT 0,
    source_type TEXT,
    source_key TEXT,
    max_attempts INTEGER DEFAULT 3,
    attempt_count INTEGER DEFAULT 0,
    last_error TEXT,
    started_at TEXT,
    finished_at TEXT,
    created_at TEXT,
    updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_download_job_status ON download_job(status, job_type, priority);
CREATE INDEX IF NOT EXISTS idx_download_job_pid ON download_job(pid);
CREATE INDEX IF NOT EXISTS idx_download_job_source ON download_job(source_type, source_key);
