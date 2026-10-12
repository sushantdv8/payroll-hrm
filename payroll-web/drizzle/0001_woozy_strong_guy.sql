CREATE TABLE `backup_settings` (
	`owner` text PRIMARY KEY NOT NULL,
	`import_id` text NOT NULL,
	`data` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `salary_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`employee_id` text NOT NULL,
	`month` text NOT NULL,
	`data` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_salary_owner_employee_month` ON `salary_snapshots` (`owner`,`employee_id`,`month`);--> statement-breakpoint
CREATE INDEX `idx_salary_owner_month` ON `salary_snapshots` (`owner`,`month`);