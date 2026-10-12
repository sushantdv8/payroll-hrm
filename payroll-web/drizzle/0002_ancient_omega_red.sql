CREATE TABLE `source_datasets` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`dataset_key` text NOT NULL,
	`manifest` text NOT NULL,
	`manifest_hash` text NOT NULL,
	`status` text DEFAULT 'staging' NOT NULL,
	`next_sequence` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_source_owner_key` ON `source_datasets` (`owner`,`dataset_key`);--> statement-breakpoint
CREATE TABLE `source_employee_links` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`dataset` text NOT NULL,
	`source_key` text NOT NULL,
	`employee_id` text NOT NULL,
	`profile` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_source_employee_key` ON `source_employee_links` (`owner`,`dataset`,`source_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_source_employee_id` ON `source_employee_links` (`owner`,`dataset`,`employee_id`);--> statement-breakpoint
CREATE TABLE `source_packets` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`session_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`hash` text NOT NULL,
	`kind` text NOT NULL,
	`row_count` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_source_packet` ON `source_packets` (`owner`,`session_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `source_parts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`session_id` text NOT NULL,
	`table_name` text NOT NULL,
	`part` integer NOT NULL,
	`hash` text NOT NULL,
	`row_count` integer NOT NULL,
	`object_key` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_source_part` ON `source_parts` (`owner`,`session_id`,`table_name`,`part`);--> statement-breakpoint
DROP INDEX `idx_employees_owner_paycode`;--> statement-breakpoint
ALTER TABLE `employees` ADD `dataset` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `employees` ADD `import_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_employees_owner_dataset_paycode` ON `employees` (`owner`,`dataset`,`paycode`);--> statement-breakpoint
ALTER TABLE `attendance` ADD `import_id` text;--> statement-breakpoint
ALTER TABLE `holidays` ADD `dataset` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `salary_snapshots` ADD `import_id` text;