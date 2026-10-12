CREATE TABLE `master_records` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`dataset` text NOT NULL,
	`table_name` text NOT NULL,
	`record_key` text NOT NULL,
	`data` text NOT NULL,
	`origin` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`deleted` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_master_record` ON `master_records` (`owner`,`dataset`,`table_name`,`record_key`);