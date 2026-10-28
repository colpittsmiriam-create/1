import {sqliteTable,text,integer,real,index,primaryKey,foreignKey,check} from 'drizzle-orm/sqlite-core';
import {sql} from 'drizzle-orm';
export const projects=sqliteTable('projects',{
 id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),name:text('name').notNull(),phase:text('phase').notNull(),
 payload:text('payload').notNull(),assetKey:text('asset_key'),assetHash:text('asset_hash'),version:integer('version').notNull().default(1),
 createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),archivedAt:text('archived_at'),
 normalizedVersion:integer('normalized_version').notNull().default(0),mutationToken:text('mutation_token'),
 workflowStatus:text('workflow_status').notNull().default('draft'),
 siteWidth:real('site_width').notNull().default(120),siteHeight:real('site_height').notNull().default(80),source:text('source').notNull().default('模拟场地'),
 modelRevision:integer('model_revision').notNull().default(1),requiredArea:real('required_area').notNull().default(60),activeTaskId:text('active_task_id'),selectedYardId:text('selected_yard_id')
},t=>[index('projects_owner_updated').on(t.ownerId,t.updatedAt)]);
export const writeLimits=sqliteTable('write_limits',{
 ownerId:text('owner_id').primaryKey(),windowId:integer('window_id').notNull(),count:integer('count').notNull()
});
export const users=sqliteTable('user_accounts',{
 id:text('id').primaryKey(),email:text('email').notNull(),displayName:text('display_name').notNull(),createdAt:text('created_at').notNull(),lastSeenAt:text('last_seen_at').notNull()
},t=>[index('user_email_lookup').on(t.email)]);
export const members=sqliteTable('project_members',{
 projectId:text('project_id').notNull().references(()=>projects.id,{onDelete:'cascade'}),userId:text('user_id').notNull().references(()=>users.id,{onDelete:'cascade'}),role:text('role').notNull(),createdAt:text('created_at').notNull()
},t=>[primaryKey({columns:[t.projectId,t.userId]}),index('member_user_projects').on(t.userId),check('member_role',sql`${t.role} in ('editor','viewer')`)]);
export const nodes=sqliteTable('site_nodes',{
 projectId:text('project_id').notNull().references(()=>projects.id,{onDelete:'cascade'}),id:text('node_id').notNull(),label:text('label').notNull(),x:real('x').notNull(),y:real('y').notNull()
},t=>[primaryKey({columns:[t.projectId,t.id]}),check('node_coordinates',sql`${t.x} >= 0 and ${t.y} >= 0`)]);
export const roads=sqliteTable('site_roads',{
 projectId:text('project_id').notNull().references(()=>projects.id,{onDelete:'cascade'}),id:text('road_id').notNull(),from:text('from_node').notNull(),to:text('to_node').notNull(),length:real('length_m').notNull(),width:real('width_m').notNull(),closed:integer('closed').notNull().default(0)
},t=>[primaryKey({columns:[t.projectId,t.id]}),foreignKey({columns:[t.projectId,t.from],foreignColumns:[nodes.projectId,nodes.id]}),foreignKey({columns:[t.projectId,t.to],foreignColumns:[nodes.projectId,nodes.id]}),check('road_dimensions',sql`${t.length}>0 and ${t.width}>0 and ${t.from}<>${t.to} and ${t.closed} in (0,1)`)]);
export const tasks=sqliteTable('transport_tasks',{
 projectId:text('project_id').notNull().references(()=>projects.id,{onDelete:'cascade'}),id:text('task_id').notNull(),name:text('name').notNull(),material:text('material').notNull(),start:text('start_node').notNull(),end:text('end_node').notNull(),trips:integer('trips').notNull(),width:real('width_m').notNull(),speed:real('speed_mps').notNull(),handling:real('handling_min').notNull(),hourlyRate:real('hourly_rate').notNull(),baseline:real('baseline_m').notNull(),windowStart:text('window_start').notNull(),windowEnd:text('window_end').notNull(),resource:text('resource').notNull()
},t=>[primaryKey({columns:[t.projectId,t.id]}),foreignKey({columns:[t.projectId,t.start],foreignColumns:[nodes.projectId,nodes.id]}),foreignKey({columns:[t.projectId,t.end],foreignColumns:[nodes.projectId,nodes.id]}),index('task_resource_window').on(t.projectId,t.resource,t.windowStart),check('task_numbers',sql`${t.trips}>0 and ${t.width}>0 and ${t.speed}>0 and ${t.handling}>=0 and ${t.hourlyRate}>=0 and ${t.baseline}>=0`)]);
export const yards=sqliteTable('storage_yards',{
 projectId:text('project_id').notNull().references(()=>projects.id,{onDelete:'cascade'}),id:text('yard_id').notNull(),name:text('name').notNull(),node:text('node_id').notNull(),area:real('area_m2').notNull(),relocation:real('relocation_cost').notNull(),approved:integer('approved').notNull().default(0)
},t=>[primaryKey({columns:[t.projectId,t.id]}),foreignKey({columns:[t.projectId,t.node],foreignColumns:[nodes.projectId,nodes.id]}),check('yard_numbers',sql`${t.area}>=0 and ${t.relocation}>=0 and ${t.approved} in (0,1)`)]);
export const restrictions=sqliteTable('road_restrictions',{
 projectId:text('project_id').notNull().references(()=>projects.id,{onDelete:'cascade'}),id:text('restriction_id').notNull(),name:text('name').notNull(),start:text('start_time').notNull(),end:text('end_time').notNull()
},t=>[primaryKey({columns:[t.projectId,t.id]})]);
export const restrictionRoads=sqliteTable('restriction_roads',{
 projectId:text('project_id').notNull(),restrictionId:text('restriction_id').notNull(),roadId:text('road_id').notNull()
},t=>[primaryKey({columns:[t.projectId,t.restrictionId,t.roadId]}),foreignKey({columns:[t.projectId,t.restrictionId],foreignColumns:[restrictions.projectId,restrictions.id],name:'restriction_parent_fk'}).onDelete('cascade'),foreignKey({columns:[t.projectId,t.roadId],foreignColumns:[roads.projectId,roads.id],name:'restriction_road_fk'})]);
export const annotations=sqliteTable('site_annotations',{
 projectId:text('project_id').notNull().references(()=>projects.id,{onDelete:'cascade'}),id:text('annotation_id').notNull(),label:text('label').notNull(),x:real('x').notNull(),y:real('y').notNull()
},t=>[primaryKey({columns:[t.projectId,t.id]})]);
export const reviews=sqliteTable('project_reviews',{
 projectId:text('project_id').notNull().references(()=>projects.id,{onDelete:'cascade'}),kind:integer('kind').notNull(),checked:integer('checked').notNull().default(0),reviewerId:text('reviewer_id'),reviewedAt:text('reviewed_at')
},t=>[primaryKey({columns:[t.projectId,t.kind]}),check('review_kind',sql`${t.kind} between 0 and 2 and ${t.checked} in (0,1)`)]);
export const versions=sqliteTable('project_versions',{
 projectId:text('project_id').notNull().references(()=>projects.id,{onDelete:'cascade'}),version:integer('version').notNull(),payload:text('payload').notNull(),assetKey:text('asset_key'),assetHash:text('asset_hash'),action:text('action').notNull(),actorId:text('actor_id'),createdAt:text('created_at').notNull()
},t=>[primaryKey({columns:[t.projectId,t.version]})]);
export const runs=sqliteTable('planning_runs',{
 id:text('id').primaryKey(),projectId:text('project_id').notNull(),inputVersion:integer('input_version').notNull(),inputHash:text('input_hash').notNull(),taskId:text('task_id'),status:text('status').notNull(),result:text('result').notNull(),actorId:text('actor_id').notNull(),createdAt:text('created_at').notNull()
},t=>[foreignKey({columns:[t.projectId,t.inputVersion],foreignColumns:[versions.projectId,versions.version]}).onDelete('cascade'),index('runs_project_version').on(t.projectId,t.inputVersion),index('runs_created').on(t.projectId,t.createdAt)]);
export const audit=sqliteTable('audit_events',{
 id:text('id').primaryKey(),projectId:text('project_id').notNull(),actorId:text('actor_id').notNull(),action:text('action').notNull(),requestId:text('request_id').notNull(),metadata:text('metadata').notNull(),createdAt:text('created_at').notNull()
},t=>[index('audit_project_time').on(t.projectId,t.createdAt)]);
export const rateLimits=sqliteTable('api_rate_limits',{
 key:text('key').primaryKey(),windowId:integer('window_id').notNull(),count:integer('count').notNull()
});
export const idempotency=sqliteTable('api_idempotency',{
 ownerId:text('owner_id').notNull(),key:text('key').notNull(),requestHash:text('request_hash').notNull(),response:text('response').notNull(),status:integer('status').notNull(),createdAt:text('created_at').notNull()
},t=>[primaryKey({columns:[t.ownerId,t.key]}),index('idempotency_age').on(t.createdAt)]);
export const assetGc=sqliteTable('asset_gc',{
 key:text('key').primaryKey(),projectId:text('project_id').notNull(),createdAt:text('created_at').notNull()
},t=>[index('asset_gc_project').on(t.projectId)]);
