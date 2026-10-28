CREATE TABLE `site_annotations` (
	`project_id` text NOT NULL,
	`annotation_id` text NOT NULL,
	`label` text NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	PRIMARY KEY(`project_id`, `annotation_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `asset_gc` (
	`key` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `asset_gc_project` ON `asset_gc` (`project_id`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`request_id` text NOT NULL,
	`metadata` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_project_time` ON `audit_events` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `api_idempotency` (
	`owner_id` text NOT NULL,
	`key` text NOT NULL,
	`request_hash` text NOT NULL,
	`response` text NOT NULL,
	`status` integer NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `key`)
);
--> statement-breakpoint
CREATE INDEX `idempotency_age` ON `api_idempotency` (`created_at`);--> statement-breakpoint
CREATE TABLE `project_members` (
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`project_id`, `user_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "member_role" CHECK("project_members"."role" in ('editor','viewer'))
);
--> statement-breakpoint
CREATE INDEX `member_user_projects` ON `project_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `site_nodes` (
	`project_id` text NOT NULL,
	`node_id` text NOT NULL,
	`label` text NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	PRIMARY KEY(`project_id`, `node_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "node_coordinates" CHECK("site_nodes"."x" >= 0 and "site_nodes"."y" >= 0)
);
--> statement-breakpoint
CREATE TABLE `api_rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`window_id` integer NOT NULL,
	`count` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `restriction_roads` (
	`project_id` text NOT NULL,
	`restriction_id` text NOT NULL,
	`road_id` text NOT NULL,
	PRIMARY KEY(`project_id`, `restriction_id`, `road_id`),
	FOREIGN KEY (`project_id`,`restriction_id`) REFERENCES `road_restrictions`(`project_id`,`restriction_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`road_id`) REFERENCES `site_roads`(`project_id`,`road_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `road_restrictions` (
	`project_id` text NOT NULL,
	`restriction_id` text NOT NULL,
	`name` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	PRIMARY KEY(`project_id`, `restriction_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `project_reviews` (
	`project_id` text NOT NULL,
	`kind` integer NOT NULL,
	`checked` integer DEFAULT 0 NOT NULL,
	`reviewer_id` text,
	`reviewed_at` text,
	PRIMARY KEY(`project_id`, `kind`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "review_kind" CHECK("project_reviews"."kind" between 0 and 2 and "project_reviews"."checked" in (0,1))
);
--> statement-breakpoint
CREATE TABLE `site_roads` (
	`project_id` text NOT NULL,
	`road_id` text NOT NULL,
	`from_node` text NOT NULL,
	`to_node` text NOT NULL,
	`length_m` real NOT NULL,
	`width_m` real NOT NULL,
	`closed` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`project_id`, `road_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`from_node`) REFERENCES `site_nodes`(`project_id`,`node_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`to_node`) REFERENCES `site_nodes`(`project_id`,`node_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "road_dimensions" CHECK("site_roads"."length_m">0 and "site_roads"."width_m">0 and "site_roads"."from_node"<>"site_roads"."to_node" and "site_roads"."closed" in (0,1))
);
--> statement-breakpoint
CREATE TABLE `planning_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`input_version` integer NOT NULL,
	`input_hash` text NOT NULL,
	`task_id` text,
	`status` text NOT NULL,
	`result` text NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`,`input_version`) REFERENCES `project_versions`(`project_id`,`version`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `runs_project_version` ON `planning_runs` (`project_id`,`input_version`);--> statement-breakpoint
CREATE INDEX `runs_created` ON `planning_runs` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `transport_tasks` (
	`project_id` text NOT NULL,
	`task_id` text NOT NULL,
	`name` text NOT NULL,
	`material` text NOT NULL,
	`start_node` text NOT NULL,
	`end_node` text NOT NULL,
	`trips` integer NOT NULL,
	`width_m` real NOT NULL,
	`speed_mps` real NOT NULL,
	`handling_min` real NOT NULL,
	`hourly_rate` real NOT NULL,
	`baseline_m` real NOT NULL,
	`window_start` text NOT NULL,
	`window_end` text NOT NULL,
	`resource` text NOT NULL,
	PRIMARY KEY(`project_id`, `task_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`start_node`) REFERENCES `site_nodes`(`project_id`,`node_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`end_node`) REFERENCES `site_nodes`(`project_id`,`node_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "task_numbers" CHECK("transport_tasks"."trips">0 and "transport_tasks"."width_m">0 and "transport_tasks"."speed_mps">0 and "transport_tasks"."handling_min">=0 and "transport_tasks"."hourly_rate">=0 and "transport_tasks"."baseline_m">=0)
);
--> statement-breakpoint
CREATE INDEX `task_resource_window` ON `transport_tasks` (`project_id`,`resource`,`window_start`);--> statement-breakpoint
CREATE TABLE `user_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `user_email_lookup` ON `user_accounts` (`email`);--> statement-breakpoint
CREATE TABLE `project_versions` (
	`project_id` text NOT NULL,
	`version` integer NOT NULL,
	`payload` text NOT NULL,
	`asset_key` text,
	`asset_hash` text,
	`action` text NOT NULL,
	`actor_id` text,
	`created_at` text NOT NULL,
	PRIMARY KEY(`project_id`, `version`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `storage_yards` (
	`project_id` text NOT NULL,
	`yard_id` text NOT NULL,
	`name` text NOT NULL,
	`node_id` text NOT NULL,
	`area_m2` real NOT NULL,
	`relocation_cost` real NOT NULL,
	`approved` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`project_id`, `yard_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`node_id`) REFERENCES `site_nodes`(`project_id`,`node_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "yard_numbers" CHECK("storage_yards"."area_m2">=0 and "storage_yards"."relocation_cost">=0 and "storage_yards"."approved" in (0,1))
);
--> statement-breakpoint
ALTER TABLE `projects` ADD `normalized_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `mutation_token` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `workflow_status` text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `site_width` real DEFAULT 120 NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `site_height` real DEFAULT 80 NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `source` text DEFAULT '模拟场地' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `model_revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `required_area` real DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `active_task_id` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `selected_yard_id` text;