ALTER TABLE `pic` ADD `first_seen_at` text;--> statement-breakpoint
ALTER TABLE `pic` ADD `last_seen_at` text;--> statement-breakpoint
ALTER TABLE `pic` ADD `last_source_type` text;--> statement-breakpoint
ALTER TABLE `pic` ADD `download_stage` text DEFAULT 'none';--> statement-breakpoint
ALTER TABLE `pic` ADD `preview_downloaded_at` text;--> statement-breakpoint
ALTER TABLE `pic` ADD `full_downloaded_at` text;--> statement-breakpoint
ALTER TABLE `pic` ADD `image_variants` text DEFAULT '{}';--> statement-breakpoint
CREATE INDEX `idx_pic_download_stage` ON `pic` (`download_stage`);--> statement-breakpoint
CREATE INDEX `idx_pic_last_seen` ON `pic` (`last_seen_at`);