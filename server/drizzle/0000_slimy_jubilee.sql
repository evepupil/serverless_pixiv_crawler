ALTER TABLE `pic_task` ADD COLUMN `priority` integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `pic_task` ADD COLUMN `task_source_type` text DEFAULT 'unknown';
--> statement-breakpoint
ALTER TABLE `pic_task` ADD COLUMN `task_source_key` text;
--> statement-breakpoint
ALTER TABLE `pic_task` ADD COLUMN `source_recent_at` text;
--> statement-breakpoint
ALTER TABLE `pic_task` ADD COLUMN `attempt_count` integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `pic_task` ADD COLUMN `next_retry_at` text;
--> statement-breakpoint
ALTER TABLE `pic_task` ADD COLUMN `last_error` text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_pic_task_priority` ON `pic_task` (`priority`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_pic_task_source_recent` ON `pic_task` (`task_source_type`,`source_recent_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `download_job` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pid` text NOT NULL,
	`job_type` text NOT NULL,
	`requested_sizes` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`priority` integer DEFAULT 0,
	`source_type` text,
	`source_key` text,
	`max_attempts` integer DEFAULT 3,
	`attempt_count` integer DEFAULT 0,
	`last_error` text,
	`started_at` text,
	`finished_at` text,
	`created_at` text,
	`updated_at` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_download_job_status` ON `download_job` (`status`,`job_type`,`priority`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_download_job_pid` ON `download_job` (`pid`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_download_job_source` ON `download_job` (`source_type`,`source_key`);
