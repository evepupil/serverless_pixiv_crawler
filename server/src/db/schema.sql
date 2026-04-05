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
    first_seen_at TEXT,
    last_seen_at TEXT,
    last_source_type TEXT,
    download_stage TEXT DEFAULT 'none',
    preview_downloaded_at TEXT,
    full_downloaded_at TEXT,
    image_variants TEXT DEFAULT '{}',
    created_at TEXT,
    updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_pic_popularity ON pic(popularity DESC);
CREATE INDEX IF NOT EXISTS idx_pic_author_id ON pic(author_id);
CREATE INDEX IF NOT EXISTS idx_pic_download_time ON pic(download_time);
CREATE INDEX IF NOT EXISTS idx_pic_unfit ON pic(unfit);
CREATE INDEX IF NOT EXISTS idx_pic_download_stage ON pic(download_stage);
CREATE INDEX IF NOT EXISTS idx_pic_last_seen ON pic(last_seen_at);

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

CREATE TABLE IF NOT EXISTS pic_source (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pid TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_key TEXT NOT NULL,
    biz_type TEXT,
    rank_value INTEGER,
    source_score REAL,
    meta TEXT,
    discovered_at TEXT NOT NULL,
    created_at TEXT,
    updated_at TEXT,
    UNIQUE(pid, source_type, source_key)
);

CREATE INDEX IF NOT EXISTS idx_pic_source_pid ON pic_source(pid);
CREATE INDEX IF NOT EXISTS idx_pic_source_type_recent ON pic_source(source_type, discovered_at);
CREATE INDEX IF NOT EXISTS idx_pic_source_biz_recent ON pic_source(biz_type, discovered_at);

CREATE TABLE IF NOT EXISTS watch_target (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_type TEXT NOT NULL,
    target_value TEXT NOT NULL,
    biz_type TEXT NOT NULL DEFAULT 'general',
    priority INTEGER DEFAULT 500,
    window_days INTEGER DEFAULT 7,
    daily_preview_quota INTEGER DEFAULT 50,
    enabled INTEGER DEFAULT 1,
    last_run_at TEXT,
    meta TEXT,
    created_at TEXT,
    updated_at TEXT,
    UNIQUE(target_type, target_value, biz_type)
);

CREATE INDEX IF NOT EXISTS idx_watch_target_enabled_priority ON watch_target(enabled, priority);
CREATE INDEX IF NOT EXISTS idx_watch_target_type_biz ON watch_target(target_type, biz_type);
CREATE INDEX IF NOT EXISTS idx_watch_target_last_run ON watch_target(last_run_at);

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
