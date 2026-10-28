import {sqliteTable,text,integer,index} from 'drizzle-orm/sqlite-core';
export const projects=sqliteTable('projects',{
 id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),name:text('name').notNull(),phase:text('phase').notNull(),
 payload:text('payload').notNull(),assetKey:text('asset_key'),assetHash:text('asset_hash'),version:integer('version').notNull().default(1),
 createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),archivedAt:text('archived_at')
},t=>[index('projects_owner_updated').on(t.ownerId,t.updatedAt)]);
export const writeLimits=sqliteTable('write_limits',{
 ownerId:text('owner_id').primaryKey(),windowId:integer('window_id').notNull(),count:integer('count').notNull()
});
