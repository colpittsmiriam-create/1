import Core from '../engine.mjs';
import {fail,now,uuid,digest,version,pageOf,pageResult,idempotencyStatement} from '../http/middleware.mjs';
import {validate,businessSignature,editEntity,readyForReview,calculation,collections} from '../domain/project.mjs';
import * as repo from '../repositories/projects.mjs';
import {stageAsset,imageFor,garbageCollect} from './assets.mjs';

export async function getProject(ctx,id){
 const row=await repo.rowFor(ctx,id),project=await repo.readModel(ctx,row);project.background=await imageFor(ctx,row.asset_key);ctx.etag=row.version;
 return {id:row.id,version:row.version,project,role:row.role,workflowStatus:row.workflow_status,updatedAt:row.updated_at,archivedAt:row.archived_at};
}
export async function listProjects(ctx){
 const archived=new URL(ctx.request.url).searchParams.get('archived')==='1',owner=ctx.user.userId,paging=pageOf(ctx.request.url,30);
 const where=archived?'p.owner_id=? AND p.archived_at IS NOT NULL':'(p.owner_id=? OR m.user_id=?) AND p.archived_at IS NULL';
 const bindings=archived?[owner]:[owner,owner];
 const data=await ctx.db.prepare(`SELECT p.id,p.name,p.phase,p.version,p.updated_at,p.archived_at,p.workflow_status,CASE WHEN p.owner_id=? THEN 'owner' ELSE m.role END AS role FROM projects p LEFT JOIN project_members m ON m.project_id=p.id AND m.user_id=? WHERE ${where} ORDER BY p.updated_at DESC,p.id DESC LIMIT ? OFFSET ?`).bind(owner,owner,...bindings,paging.limit,paging.offset).all();
 const total=await ctx.db.prepare(`SELECT COUNT(*) AS n FROM projects p LEFT JOIN project_members m ON m.project_id=p.id AND m.user_id=? WHERE ${where}`).bind(owner,...bindings).first();
 const items=data.results.map(repo.summary);return {projects:items,limit:30,pagination:pageResult(items,total.n,paging)};
}
function modelMeta(p){return {reviews:p.reviews,revision:p.revision,updatedAt:p.updatedAt,history:p.history};}
async function save(ctx,row,input,{create=false,action='project_updated',assetOverride,restoring=false}={}){
 if(!create){repo.authorize(row,'write');if(version(ctx.request)!==row.version)fail(409,'云端版本已有变化，请重新载入','VERSION_CONFLICT');}
 const previous=create?null:await repo.readModel(ctx,row,{migrate:false}),p=validate(input);
 const asset=assetOverride||await stageAsset(ctx,row.id,p.background,row);p.background=null;
 try{
  const changed=create||restoring||businessSignature(previous,row.asset_hash)!==businessSignature(p,asset.hash),time=now();
  const oldReviews=create?[]:await repo.reviewsFor(ctx,row.id);
  if(changed)p.reviews=[false,false,false];
  p.revision=create?1:changed?previous.revision+1:previous.revision;p.updatedAt=time;
  p.history=create?[{revision:1,at:time,action:'创建云端项目',summary:p.name}]:changed?[...previous.history,{revision:p.revision,at:time,action,summary:p.name}].slice(-30):previous.history;
  const reviewRecords=p.reviews.map((checked,kind)=>{
   const previousReview=oldReviews.find(r=>r.kind===kind);
   return {kind,checked,reviewerId:checked?(previousReview?.checked?previousReview.reviewer_id:ctx.user.userId):null,reviewedAt:checked?(previousReview?.checked?previousReview.reviewed_at:time):null};
  });
  const result=await repo.persist(ctx,row,p,asset,{action,status:changed?'draft':row.workflow_status,create,reviewRecords});
  ctx.afterCommit.push(()=>garbageCollect(ctx,row.id));return {...result,modelMeta:modelMeta(p)};
 }catch(error){if(asset.staged)await ctx.env.BUCKET.delete(asset.staged).catch(()=>{});throw error;}
}
export async function createProject(ctx){
 const count=await ctx.db.prepare('SELECT COUNT(*) AS n FROM projects WHERE owner_id=?').bind(ctx.user.userId).first();
 if(count.n>=30)fail(409,'账号最多保存 30 个项目（含归档）','PROJECT_LIMIT');
 const p=validate(ctx.body.project),id=uuid();return save(ctx,{id,role:'owner'},p,{create:true,action:'project_created'});
}
export async function updateProject(ctx,id){const row=await repo.rowFor(ctx,id);return save(ctx,row,ctx.body.project);}
export async function listEntities(ctx,id,collection,itemId){
 if(!collections[collection])fail(404,'资源不存在','NOT_FOUND');
 const row=await repo.rowFor(ctx,id),p=await repo.readModel(ctx,row),items=p[collections[collection].key];
 if(itemId){const item=items.find(i=>i.id===itemId);if(!item)fail(404,'记录不存在','NOT_FOUND');return {item,version:row.version};}
 const paging=pageOf(ctx.request.url);return {...pageResult(items.slice(paging.offset,paging.offset+paging.limit),items.length,paging),version:row.version};
}
export async function mutateEntity(ctx,id,collection,itemId){
 const row=await repo.rowFor(ctx,id);repo.authorize(row,'write');if(version(ctx.request)!==row.version)fail(409,'项目已有更新','VERSION_CONFLICT');
 const previous=await repo.readModel(ctx,row,{migrate:false}),model=editEntity(previous,collection,ctx.request.method,itemId,ctx.body);
 model.background=await imageFor(ctx,row.asset_key);
 return save(ctx,row,model,{action:collection+'_'+ctx.request.method.toLowerCase(),assetOverride:{key:row.asset_key,hash:row.asset_hash,staged:null}});
}
export async function updateSettings(ctx,id){
 const allowed=['name','phase','source','siteWidth','siteHeight','requiredArea','selectedYard'];
 if(Object.keys(ctx.body).some(key=>!allowed.includes(key)))fail(422,'包含不支持的项目字段','UNKNOWN_FIELDS');
 const row=await repo.rowFor(ctx,id);repo.authorize(row,'write');const previous=await repo.readModel(ctx,row,{migrate:false});
 return save(ctx,row,{...previous,...ctx.body},{action:'settings_updated',assetOverride:{key:row.asset_key,hash:row.asset_hash,staged:null}});
}
export async function archiveProject(ctx,id,restore=false){
 let row=await repo.rowFor(ctx,id,restore);repo.authorize(row,'owner');if(version(ctx.request)!==row.version)fail(409,'项目已有更新','VERSION_CONFLICT');
 row=await repo.ensureNormalized(ctx,row);const result=await repo.simpleMutation(ctx,row,{archivedAt:restore?null:now(),action:restore?'project_restored':'project_archived'});ctx.afterCommit.push(()=>garbageCollect(ctx,id));return result;
}
export async function deletePermanently(ctx,id){
 const row=await repo.rowFor(ctx,id,true);repo.authorize(row,'owner');if(!row.archived_at)fail(409,'请先归档项目再永久删除','ARCHIVE_REQUIRED');
 if(version(ctx.request)!==row.version)fail(409,'项目已有更新','VERSION_CONFLICT');
 const token=uuid(),time=now(),guard=repo.gate,response={deleted:true};
 const statements=[ctx.db.prepare('UPDATE projects SET mutation_token=? WHERE id=? AND version=? AND owner_id=? AND archived_at IS NOT NULL').bind(token,id,row.version,ctx.user.userId),
 ctx.db.prepare(`INSERT OR IGNORE INTO asset_gc (key,project_id,created_at) SELECT asset_key,id,? FROM projects WHERE id=? AND asset_key IS NOT NULL AND ${guard}`).bind(time,id,id,token),
 ctx.db.prepare(`INSERT OR IGNORE INTO asset_gc (key,project_id,created_at) SELECT asset_key,project_id,? FROM project_versions WHERE project_id=? AND asset_key IS NOT NULL AND ${guard}`).bind(time,id,id,token),
 repo.auditStatement(ctx,id,'project_deleted',{version:row.version},guard,[id,token])];
 const idem=idempotencyStatement(ctx,response,200,guard,[id,token]);if(idem)statements.push(idem);
 statements.push(ctx.db.prepare(`DELETE FROM projects WHERE id=? AND ${guard}`).bind(id,id,token));
 const result=await ctx.db.batch(statements);if(!result[0].meta.changes)fail(409,'项目已有更新','VERSION_CONFLICT');ctx.afterCommit.push(()=>garbageCollect(ctx,id,40));return response;
}
export async function runPlanning(ctx,id){
 const row=await repo.rowFor(ctx,id);repo.authorize(row,'write');if(version(ctx.request)!==row.version)fail(409,'项目已有更新，请先保存并重试','VERSION_CONFLICT');
 const p=await repo.readModel(ctx,row),result=calculation(p,ctx.body.taskId),runId=uuid(),time=now(),inputHash=await digest(JSON.stringify({...p,background:null}));
 const response={id:runId,projectId:id,inputVersion:row.version,inputHash,status:result.result.distance===null?'no_solution':result.issues.length?'needs_review':'success',result,createdAt:time};
 const guard='EXISTS (SELECT 1 FROM planning_runs WHERE id=?)';
 const statements=[ctx.db.prepare('INSERT INTO planning_runs (id,project_id,input_version,input_hash,task_id,status,result,actor_id,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM projects WHERE id=? AND version=? AND archived_at IS NULL AND (owner_id=? OR EXISTS (SELECT 1 FROM project_members WHERE project_id=? AND user_id=? AND role=\'editor\')))')
 .bind(runId,id,row.version,inputHash,result.taskId,response.status,JSON.stringify(result),ctx.user.userId,time,id,row.version,ctx.user.userId,id,ctx.user.userId),repo.auditStatement(ctx,id,'planning_computed',{runId,inputVersion:row.version,status:response.status},guard,[runId])];
 const idem=idempotencyStatement(ctx,response,201,guard,[runId]);if(idem)statements.push(idem);
 const saved=await ctx.db.batch(statements);if(!saved[0].meta.changes)fail(409,'计算期间项目发生变化，请重算','VERSION_CONFLICT');return response;
}
export async function listRuns(ctx,id,runId){
 const row=await repo.rowFor(ctx,id),paging=pageOf(ctx.request.url);
 if(runId){const saved=await ctx.db.prepare('SELECT * FROM planning_runs WHERE id=? AND project_id=?').bind(runId,id).first();if(!saved)fail(404,'计算记录不存在','NOT_FOUND');return {...saved,result:JSON.parse(saved.result),stale:saved.input_version!==row.version};}
 const items=(await ctx.db.prepare('SELECT id,input_version AS inputVersion,input_hash AS inputHash,task_id AS taskId,status,created_at AS createdAt FROM planning_runs WHERE project_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?').bind(id,paging.limit,paging.offset).all()).results.map(r=>({...r,stale:r.inputVersion!==row.version}));
 const total=await ctx.db.prepare('SELECT COUNT(*) AS n FROM planning_runs WHERE project_id=?').bind(id).first();return pageResult(items,total.n,paging);
}
export async function preview(ctx,id){const row=await repo.rowFor(ctx,id),p=await repo.readModel(ctx,row),result=calculation(p,new URL(ctx.request.url).searchParams.get('taskId'));return {id,version:row.version,taskId:result.taskId,result:result.result,issues:result.issues,fieldVerified:false};}
export async function workflow(ctx,id,action){
 let row=await repo.rowFor(ctx,id);repo.authorize(row,'owner');if(version(ctx.request)!==row.version)fail(409,'项目已有更新','VERSION_CONFLICT');
 row=await repo.ensureNormalized(ctx,row);const p=await repo.readModel(ctx,row);readyForReview(p);
 if(action==='approve'){
  if(row.workflow_status!=='in_review')fail(409,'请先提交复核，再确认方案','INVALID_TRANSITION');
  const reviews=await repo.reviewsFor(ctx,id);if(reviews.length!==3||reviews.some(r=>!r.checked||!r.reviewer_id||!r.reviewed_at))fail(422,'三项复核都需要由项目成员重新确认并保存','REVIEW_REQUIRED');
 }else if(row.workflow_status!=='draft')fail(409,'当前方案状态不能重复提交','INVALID_TRANSITION');
 const response=await repo.simpleMutation(ctx,row,{archivedAt:null,status:action==='approve'?'approved':'in_review',action:action==='approve'?'plan_approved':'plan_submitted'});ctx.afterCommit.push(()=>garbageCollect(ctx,id));return response;
}
export async function versions(ctx,id){
 let row=await repo.rowFor(ctx,id);row=await repo.ensureNormalized(ctx,row);const paging=pageOf(ctx.request.url);
 const rows=(await ctx.db.prepare('SELECT version,action,actor_id AS actorId,created_at AS createdAt FROM project_versions WHERE project_id=? ORDER BY version DESC LIMIT ? OFFSET ?').bind(id,paging.limit,paging.offset).all()).results;
 const total=await ctx.db.prepare('SELECT COUNT(*) AS n FROM project_versions WHERE project_id=?').bind(id).first();return {...pageResult(rows,total.n,paging),currentVersion:row.version};
}
export async function restoreVersion(ctx,id,requested){
 const row=await repo.rowFor(ctx,id);repo.authorize(row,'write');const target=Number(requested);if(!Number.isInteger(target)||target<1)fail(400,'版本号无效','INVALID_VERSION');
 const snapshot=await ctx.db.prepare('SELECT * FROM project_versions WHERE project_id=? AND version=?').bind(id,target).first();if(!snapshot)fail(404,'历史版本不存在或已超出保留范围','NOT_FOUND');
 const p=validate(JSON.parse(snapshot.payload));p.reviews=[false,false,false];
 return save(ctx,row,p,{action:'version_restored_'+target,restoring:true,assetOverride:{key:snapshot.asset_key,hash:snapshot.asset_hash,staged:null}});
}
export async function auditEvents(ctx,id){
 await repo.rowFor(ctx,id);const paging=pageOf(ctx.request.url),items=(await ctx.db.prepare('SELECT id,actor_id AS actorId,action,request_id AS requestId,metadata,created_at AS createdAt FROM audit_events WHERE project_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?').bind(id,paging.limit,paging.offset).all()).results.map(r=>({...r,metadata:JSON.parse(r.metadata)}));
 const total=await ctx.db.prepare('SELECT COUNT(*) AS n FROM audit_events WHERE project_id=?').bind(id).first();return pageResult(items,total.n,paging);
}
export async function members(ctx,id,memberId){
 const row=await repo.rowFor(ctx,id);if(ctx.request.method==='GET'){
  const people=(await ctx.db.prepare('SELECT m.user_id AS userId,m.role,u.email,u.display_name AS name FROM project_members m JOIN user_accounts u ON u.id=m.user_id WHERE m.project_id=? ORDER BY m.created_at').bind(id).all()).results;
  const owner=await ctx.db.prepare('SELECT id AS userId,email,display_name AS name FROM user_accounts WHERE id=?').bind(row.owner_id).first();return {members:[{...owner,role:'owner'},...people],role:row.role};
 }
 repo.authorize(row,'owner');const time=now(),guard='EXISTS (SELECT 1 FROM projects WHERE id=? AND owner_id=?)';let statement,response;
 if(ctx.request.method==='POST'){
  const email=String(ctx.body.email||'').trim().toLowerCase(),role=ctx.body.role;if(!email.includes('@')||!['viewer','editor'].includes(role))fail(422,'请输入已登录过本站的账号邮箱和有效角色','INVALID_MEMBER');
  const person=await ctx.db.prepare('SELECT id,email,display_name FROM user_accounts WHERE email=? ORDER BY last_seen_at DESC LIMIT 1').bind(email).first();if(!person)fail(404,'该账号尚未登录过本站，请先让成员登录一次','MEMBER_NOT_REGISTERED');
  if(person.id===row.owner_id)fail(422,'不能修改项目所有者的角色','OWNER_IMMUTABLE');
  const count=await ctx.db.prepare('SELECT COUNT(*) AS n FROM project_members WHERE project_id=?').bind(id).first();
  const exists=await ctx.db.prepare('SELECT 1 FROM project_members WHERE project_id=? AND user_id=?').bind(id,person.id).first();if(count.n>=20&&!exists)fail(409,'每个项目最多 20 位协作成员','MEMBER_LIMIT');
  statement=ctx.db.prepare('INSERT INTO project_members (project_id,user_id,role,created_at) SELECT ?,?,?,? WHERE '+guard+' AND ((SELECT COUNT(*) FROM project_members WHERE project_id=?)<20 OR EXISTS (SELECT 1 FROM project_members WHERE project_id=? AND user_id=?)) ON CONFLICT(project_id,user_id) DO UPDATE SET role=excluded.role').bind(id,person.id,role,time,id,ctx.user.userId,id,id,person.id);
  response={userId:person.id,role};
 }else if(ctx.request.method==='DELETE'){
  if(memberId===row.owner_id)fail(422,'不能移除项目所有者','OWNER_IMMUTABLE');
  statement=ctx.db.prepare('DELETE FROM project_members WHERE project_id=? AND user_id=? AND '+guard).bind(id,memberId,id,ctx.user.userId);response={removed:true,userId:memberId};
 }else fail(405,'不支持此操作','METHOD_NOT_ALLOWED');
 const statements=[statement,repo.auditStatement(ctx,id,'member_'+(ctx.request.method==='POST'?'updated':'removed'),response,guard,[id,ctx.user.userId])],idem=idempotencyStatement(ctx,response,200,guard,[id,ctx.user.userId]);if(idem)statements.push(idem);await ctx.db.batch(statements);return response;
}
