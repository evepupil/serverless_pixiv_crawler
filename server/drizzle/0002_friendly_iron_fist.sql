CREATE TABLE `watch_target` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`target_type` text NOT NULL,
	`target_value` text NOT NULL,
	`biz_type` text DEFAULT 'general' NOT NULL,
	`priority` integer DEFAULT 500,
	`window_days` integer DEFAULT 7,
	`daily_preview_quota` integer DEFAULT 50,
	`enabled` integer DEFAULT 1,
	`last_run_at` text,
	`meta` text,
	`created_at` text,
	`updated_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `watch_target_type_value_biz_unique` ON `watch_target` (`target_type`,`target_value`,`biz_type`);--> statement-breakpoint
CREATE INDEX `idx_watch_target_enabled_priority` ON `watch_target` (`enabled`,`priority`);--> statement-breakpoint
CREATE INDEX `idx_watch_target_type_biz` ON `watch_target` (`target_type`,`biz_type`);--> statement-breakpoint
CREATE INDEX `idx_watch_target_last_run` ON `watch_target` (`last_run_at`);