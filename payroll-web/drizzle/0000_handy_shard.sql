CREATE TABLE `attendance` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`employee_id` text NOT NULL,
	`month` text NOT NULL,
	`data` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_attendance_owner_employee_month` ON `attendance` (`owner`,`employee_id`,`month`);--> statement-breakpoint
CREATE INDEX `idx_attendance_owner_month` ON `attendance` (`owner`,`month`);--> statement-breakpoint
CREATE TABLE `employees` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`paycode` text NOT NULL,
	`data` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`deleted` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_employees_owner_paycode` ON `employees` (`owner`,`paycode`);--> statement-breakpoint
CREATE INDEX `idx_employees_owner_deleted` ON `employees` (`owner`,`deleted`);--> statement-breakpoint
CREATE TABLE `holidays` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`data` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`deleted` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_holidays_owner_deleted` ON `holidays` (`owner`,`deleted`);