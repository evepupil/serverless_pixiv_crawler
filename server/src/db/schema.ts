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
  createdAt: text('created_at'),
  updatedAt: text('updated_at')
}, table => [
  index('idx_pic_popularity').on(table.popularity),
  index('idx_pic_author_id').on(table.authorId),
  index('idx_pic_download_time').on(table.downloadTime),
  index('idx_pic_unfit').on(table.unfit)
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
  createdAt: text('created_at'),
  updatedAt: text('updated_at')
}, table => [
  index('idx_pic_task_illust_recommend').on(table.illustRecommendCrawled),
  index('idx_pic_task_author_recommend').on(table.authorRecommendCrawled),
  index('idx_pic_task_detail_info').on(table.detailInfoCrawled)
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

export const schema = {
  pic,
  picTask,
  ranking
};

export type PicRow = typeof pic.$inferSelect;
export type NewPicRow = typeof pic.$inferInsert;
export type PicTaskRow = typeof picTask.$inferSelect;
export type NewPicTaskRow = typeof picTask.$inferInsert;
export type RankingRow = typeof ranking.$inferSelect;
export type NewRankingRow = typeof ranking.$inferInsert;

