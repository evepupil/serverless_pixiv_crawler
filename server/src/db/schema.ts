import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex
} from 'drizzle-orm/sqlite-core';

export const pic = sqliteTable('pic', {
  pid: text('pid').primaryKey(),
  title: text('title'),
  authorId: text('author_id'),
  authorName: text('author_name'),
  tag: text('tag').default(''),
  good: integer('good').default(0),
  star: integer('star').default(0),
  view: integer('view').default(0),
  popularity: real('popularity').default(0),
  imagePath: text('image_path').default(''),
  imageUrl: text('image_url').default(''),
  downloadTime: text('download_time'),
  uploadTime: text('upload_time'),
  wxUrl: text('wx_url'),
  wxName: text('wx_name'),
  unfit: integer('unfit').default(0),
  size: integer('size'),
  firstSeenAt: text('first_seen_at'),
  lastSeenAt: text('last_seen_at'),
  lastSourceType: text('last_source_type'),
  downloadStage: text('download_stage').default('none'),
  previewDownloadedAt: text('preview_downloaded_at'),
  fullDownloadedAt: text('full_downloaded_at'),
  imageVariants: text('image_variants').default('{}'),
  createdAt: text('created_at'),
  updatedAt: text('updated_at')
}, table => [
  index('idx_pic_popularity').on(table.popularity),
  index('idx_pic_author_id').on(table.authorId),
  index('idx_pic_download_time').on(table.downloadTime),
  index('idx_pic_unfit').on(table.unfit),
  index('idx_pic_download_stage').on(table.downloadStage),
  index('idx_pic_last_seen').on(table.lastSeenAt)
]);

export const picTask = sqliteTable('pic_task', {
  pid: text('pid').primaryKey(),
  illustRecommendCrawled: integer('illust_recommend_crawled').default(0),
  illustRecommendTime: text('illust_recommend_time'),
  illustRecommendCount: integer('illust_recommend_count').default(0),
  authorRecommendCrawled: integer('author_recommend_crawled').default(0),
  authorRecommendTime: text('author_recommend_time'),
  authorRecommendCount: integer('author_recommend_count').default(0),
  detailInfoCrawled: integer('detail_info_crawled').default(0),
  detailInfoTime: text('detail_info_time'),
  priority: integer('priority').default(0),
  taskSourceType: text('task_source_type').default('unknown'),
  taskSourceKey: text('task_source_key'),
  sourceRecentAt: text('source_recent_at'),
  attemptCount: integer('attempt_count').default(0),
  nextRetryAt: text('next_retry_at'),
  lastError: text('last_error'),
  createdAt: text('created_at'),
  updatedAt: text('updated_at')
}, table => [
  index('idx_pic_task_illust_recommend').on(table.illustRecommendCrawled),
  index('idx_pic_task_author_recommend').on(table.authorRecommendCrawled),
  index('idx_pic_task_detail_info').on(table.detailInfoCrawled),
  index('idx_pic_task_priority').on(table.priority),
  index('idx_pic_task_source_recent').on(table.taskSourceType, table.sourceRecentAt)
]);

export const ranking = sqliteTable('ranking', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  pid: text('pid').notNull(),
  rank: integer('rank').notNull(),
  rankType: text('rank_type').notNull(),
  rankDate: text('rank_date').notNull(),
  crawlTime: text('crawl_time').notNull()
}, table => [
  uniqueIndex('ranking_rank_type_rank_date_pid_unique').on(table.rankType, table.rankDate, table.pid),
  index('idx_ranking_type_date').on(table.rankType, table.rankDate),
  index('idx_ranking_pid').on(table.pid)
]);

export const picSource = sqliteTable('pic_source', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  pid: text('pid').notNull(),
  sourceType: text('source_type').notNull(),
  sourceKey: text('source_key').notNull(),
  bizType: text('biz_type'),
  rankValue: integer('rank_value'),
  sourceScore: real('source_score'),
  meta: text('meta'),
  discoveredAt: text('discovered_at').notNull(),
  createdAt: text('created_at'),
  updatedAt: text('updated_at')
}, table => [
  uniqueIndex('pic_source_pid_type_key_unique').on(table.pid, table.sourceType, table.sourceKey),
  index('idx_pic_source_pid').on(table.pid),
  index('idx_pic_source_type_recent').on(table.sourceType, table.discoveredAt),
  index('idx_pic_source_biz_recent').on(table.bizType, table.discoveredAt)
]);

export const watchTarget = sqliteTable('watch_target', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  targetType: text('target_type').notNull(),
  targetValue: text('target_value').notNull(),
  bizType: text('biz_type').notNull().default('general'),
  priority: integer('priority').default(500),
  windowDays: integer('window_days').default(7),
  dailyPreviewQuota: integer('daily_preview_quota').default(50),
  enabled: integer('enabled').default(1),
  lastRunAt: text('last_run_at'),
  meta: text('meta'),
  createdAt: text('created_at'),
  updatedAt: text('updated_at')
}, table => [
  uniqueIndex('watch_target_type_value_biz_unique').on(table.targetType, table.targetValue, table.bizType),
  index('idx_watch_target_enabled_priority').on(table.enabled, table.priority),
  index('idx_watch_target_type_biz').on(table.targetType, table.bizType),
  index('idx_watch_target_last_run').on(table.lastRunAt)
]);

export const downloadJob = sqliteTable('download_job', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  pid: text('pid').notNull(),
  jobType: text('job_type').notNull(),
  requestedSizes: text('requested_sizes').notNull().default('[]'),
  status: text('status').notNull().default('pending'),
  priority: integer('priority').default(0),
  sourceType: text('source_type'),
  sourceKey: text('source_key'),
  maxAttempts: integer('max_attempts').default(3),
  attemptCount: integer('attempt_count').default(0),
  lastError: text('last_error'),
  startedAt: text('started_at'),
  finishedAt: text('finished_at'),
  createdAt: text('created_at'),
  updatedAt: text('updated_at')
}, table => [
  index('idx_download_job_status').on(table.status, table.jobType, table.priority),
  index('idx_download_job_pid').on(table.pid),
  index('idx_download_job_source').on(table.sourceType, table.sourceKey)
]);

export const schema = {
  pic,
  picTask,
  ranking,
  picSource,
  watchTarget,
  downloadJob
};

export type PicRow = typeof pic.$inferSelect;
export type NewPicRow = typeof pic.$inferInsert;
export type PicTaskRow = typeof picTask.$inferSelect;
export type NewPicTaskRow = typeof picTask.$inferInsert;
export type RankingRow = typeof ranking.$inferSelect;
export type NewRankingRow = typeof ranking.$inferInsert;
export type PicSourceRow = typeof picSource.$inferSelect;
export type NewPicSourceRow = typeof picSource.$inferInsert;
export type WatchTargetRow = typeof watchTarget.$inferSelect;
export type NewWatchTargetRow = typeof watchTarget.$inferInsert;
export type DownloadJobRow = typeof downloadJob.$inferSelect;
export type NewDownloadJobRow = typeof downloadJob.$inferInsert;
