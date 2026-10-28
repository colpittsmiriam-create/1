CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`phase` text NOT NULL,
	`payload` text NOT NULL,
	`asset_key` text,
	`asset_hash` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text
);
--> statement-breakpoint
CREATE INDEX `projects_owner_updated` ON `projects` (`owner_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `write_limits` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`window_id` integer NOT NULL,
	`count` integer NOT NULL
);
