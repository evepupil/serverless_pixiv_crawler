ALTER TABLE `pic` ADD `candidate_score` real DEFAULT 0;--> statement-breakpoint
CREATE INDEX `idx_pic_candidate_score` ON `pic` (`candidate_score`);