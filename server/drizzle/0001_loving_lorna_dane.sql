CREATE TABLE `pic_source` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pid` text NOT NULL,
	`source_type` text NOT NULL,
	`source_key` text NOT NULL,
	`biz_type` text,
	`rank_value` integer,
	`source_score` real,
	`meta` text,
	`discovered_at` text NOT NULL,
	`created_at` text,
	`updated_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pic_source_pid_type_key_unique` ON `pic_source` (`pid`,`source_type`,`source_key`);--> statement-breakpoint
CREATE INDEX `idx_pic_source_pid` ON `pic_source` (`pid`);--> statement-breakpoint
CREATE INDEX `idx_pic_source_type_recent` ON `pic_source` (`source_type`,`discovered_at`);--> statement-breakpoint
CREATE INDEX `idx_pic_source_biz_recent` ON `pic_source` (`biz_type`,`discovered_at`);