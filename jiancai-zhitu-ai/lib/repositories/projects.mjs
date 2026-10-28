import {fail,now,uuid,idempotencyStatement} from '../http/middleware.mjs';
import {validate} from '../domain/project.mjs';

export const gate='EXISTS (SELECT 1 FROM projects WHERE id=? AND mutation_token=?)';
const deletionOrder=['restriction_roads','transport_tasks','storage_yards','site_roads','road_restrictions','site_nodes','site_annotations','project_reviews'];
const shapes=[
 ['site_nodes','nodes',{node_id:'id',label:'label',x:'x',y:'y'}],
 ['site_roads','edges',{road_id:'id',from_node:'from',to_node:'to',length_m:'length',width_m:'width',closed:'closed'}],
 ['transport_tasks','tasks',{task_id:'id',name:'name',material:'material',start_node:'start',end_node:'end',trips:'trips',width_m:'width',speed_mps:'speed',handling_min:'handling',hourly_rate:'hourlyRate',baseline_m:'baseline',window_start:'windowStart',window_end:'windowEnd',resource:'resource'}],
 ['storage_yards','yards',{yard_id:'id',name:'name',node_id:'node',area_m2:'area',relocation_cost:'relocation',approved:'approved'}],
 ['road_restrictions','restrictions',{restriction_id:'id',name:'name',start_time:'start',end_time:'end'}],
 ['restriction_roads','restrictionLinks',{restriction_id:'restrictionId',road_id:'roadId'}],
 ['site_annotations','annotations',{annotation_id:'id',label:'label',x:'x',y:'y'}],
 ['project_reviews','reviewRecords',{kind:'kind',checked:'checked',reviewer_id:'reviewerId',reviewed_at:'reviewedAt'}]
];
export async function rowFor(ctx,id,archived=false){
 if(typeof id!=='string'||!/^[0-9a-f-]{36}$/.test(id))fail(404,'项目不存在','NOT_FOUND');
 const row=await ctx.db.prepare(`SELECT p.*,CASE WHEN p.owner_id=? THEN 'owner' ELSE m.role END AS role FROM projects p LEFT JOIN project_members m ON m.project_id=p.id AND m.user_id=? WHERE p.id=? AND (p.owner_id=? OR m.user_id=?)${archived?'':' AND p.archived_at IS NULL'}`)
 .bind(ctx.user.userId,ctx.user.userId,id,ctx.user.userId,ctx.user.userId).first();
 if(!row)fail(404,'项目不存在或没有访问权限','NOT_FOUND');return row;
}
export function authorize(row,permission='read'){
 if(permission==='owner'&&row.role!=='owner')fail(403,'此操作仅限项目所有者','FORBIDDEN');
 if(permission==='write'&&!['owner','editor'].includes(row.role))fail(403,'当前成员只有查看权限','FORBIDDEN');
}
export function summary(row){return {id:row.id,name:row.name,phase:row.phase,version:row.version,updatedAt:row.updated_at,archivedAt:row.archived_at,role:row.role||'owner',workflowStatus:row.workflow_status};}
export function auditStatement(ctx,id,action,metadata,guard=gate,values){
 return ctx.db.prepare('INSERT INTO audit_events (id,project_id,actor_id,action,request_id,metadata,created_at) SELECT ?,?,?,?,?,?,? WHERE '+guard)
 .bind(uuid(),id,ctx.user.userId,action,ctx.requestId,JSON.stringify(metadata),now(),...(values||[id,ctx.token]));
}
function insertMany(ctx,id,token,table,rows,columns){
 const names=Object.keys(columns),expressions=Object.values(columns).map(key=>`json_extract(j.value,'$.${key}')`);
 return ctx.db.prepare(`INSERT INTO ${table} (project_id,${names.join(',')}) SELECT ?,${expressions.join(',')} FROM json_each(?) j WHERE ${gate}`)
 .bind(id,JSON.stringify(rows),id,token);
}
export function relationStatements(ctx,id,token,project,reviewRecords){
 const data={...project,restrictionLinks:project.restrictions.flatMap(r=>r.edgeIds.map(roadId=>({restrictionId:r.id,roadId}))),reviewRecords};
 return [...deletionOrder.map(table=>ctx.db.prepare(`DELETE FROM ${table} WHERE project_id=? AND ${gate}`).bind(id,id,token)),...shapes.map(([table,key,columns])=>insertMany(ctx,id,token,table,data[key],columns))];
}
function metadataValues(project){return [project.siteWidth,project.siteHeight,project.source,project.revision,project.requiredArea,project.activeTaskId,project.selectedYard];}
export function snapshotStatement(ctx,id,token,version,project,assetKey,assetHash,action,actor=ctx.user.userId,time=now()){
 return ctx.db.prepare(`INSERT OR IGNORE INTO project_versions (project_id,version,payload,asset_key,asset_hash,action,actor_id,created_at) SELECT ?,?,?,?,?,?,?,? WHERE ${gate}`)
 .bind(id,version,JSON.stringify({...project,background:null}),assetKey,assetHash,action,actor,time,id,token);
}
export async function ensureNormalized(ctx,row){
 if(row.normalized_version===row.version)return row;
 const p=validate(JSON.parse(row.payload)),token=uuid();
 const statements=[ctx.db.prepare('UPDATE projects SET site_width=?,site_height=?,source=?,model_revision=?,required_area=?,active_task_id=?,selected_yard_id=?,normalized_version=version,mutation_token=? WHERE id=? AND version=? AND normalized_version!=version')
 .bind(...metadataValues(p),token,row.id,row.version),...relationStatements(ctx,row.id,token,p,p.reviews.map((checked,kind)=>({kind,checked,reviewerId:null,reviewedAt:null}))),snapshotStatement(ctx,row.id,token,row.version,p,row.asset_key,row.asset_hash,'legacy_migration',null,row.updated_at),auditStatement(ctx,row.id,'legacy_migration',{version:row.version},gate,[row.id,token])];
 await ctx.db.batch(statements);return rowFor(ctx,row.id,!!row.archived_at);
}
export async function readModel(ctx,row,{migrate=true}={}){
 if(row.normalized_version!==row.version){if(migrate){const normalized=await ensureNormalized(ctx,row);if(normalized.version!==row.version)fail(409,'转换期间项目已更新，请重新载入','VERSION_CONFLICT');row=normalized;}else return validate(JSON.parse(row.payload));}
 // One D1 batch provides a consistent relational snapshot in a single round trip.
 const result=await ctx.db.batch([
  ctx.db.prepare('SELECT node_id AS id,label,x,y FROM site_nodes WHERE project_id=? ORDER BY rowid').bind(row.id),
  ctx.db.prepare('SELECT road_id AS id,from_node AS a,to_node AS b,length_m AS length,width_m AS width,closed FROM site_roads WHERE project_id=? ORDER BY rowid').bind(row.id),
  ctx.db.prepare('SELECT task_id AS id,name,material,start_node AS start,end_node AS end,trips,width_m AS width,speed_mps AS speed,handling_min AS handling,hourly_rate AS hourlyRate,baseline_m AS baseline,window_start AS windowStart,window_end AS windowEnd,resource FROM transport_tasks WHERE project_id=? ORDER BY rowid').bind(row.id),
  ctx.db.prepare('SELECT yard_id AS id,name,node_id AS node,area_m2 AS area,relocation_cost AS relocation,approved FROM storage_yards WHERE project_id=? ORDER BY rowid').bind(row.id),
  ctx.db.prepare('SELECT restriction_id AS id,name,start_time AS start,end_time AS end FROM road_restrictions WHERE project_id=? ORDER BY rowid').bind(row.id),
  ctx.db.prepare('SELECT restriction_id,road_id FROM restriction_roads WHERE project_id=? ORDER BY rowid').bind(row.id),
  ctx.db.prepare('SELECT annotation_id AS id,label,x,y FROM site_annotations WHERE project_id=? ORDER BY rowid').bind(row.id),
  ctx.db.prepare('SELECT kind,checked,reviewer_id,reviewed_at FROM project_reviews WHERE project_id=? ORDER BY kind').bind(row.id),
  ctx.db.prepare('SELECT version,normalized_version FROM projects WHERE id=?').bind(row.id)
 ]);
 const current=result[8].results[0];if(!current||current.version!==row.version||current.normalized_version!==row.version)fail(409,'项目刚刚发生更新，请重新载入','VERSION_CONFLICT');
 const base=JSON.parse(row.payload),links=result[5].results;
 return validate({...base,name:row.name,phase:row.phase,siteWidth:row.site_width,siteHeight:row.site_height,source:row.source,revision:row.model_revision,requiredArea:row.required_area,activeTaskId:row.active_task_id,selectedYard:row.selected_yard_id,background:null,
  nodes:result[0].results,edges:result[1].results.map(({a,b,closed,...e})=>({...e,from:a,to:b,closed:!!closed})),tasks:result[2].results,yards:result[3].results.map(y=>({...y,approved:!!y.approved})),
  restrictions:result[4].results.map(r=>({...r,edgeIds:links.filter(l=>l.restriction_id===r.id).map(l=>l.road_id)})),annotations:result[6].results,reviews:[0,1,2].map(kind=>!!result[7].results.find(r=>r.kind===kind)?.checked)});
}
export async function reviewsFor(ctx,id){return (await ctx.db.prepare('SELECT kind,checked,reviewer_id,reviewed_at FROM project_reviews WHERE project_id=? ORDER BY kind').bind(id).all()).results;}
export async function persist(ctx,row,project,asset,{action='project_updated',status='draft',reviewRecords,create=false}={}){
 const id=row.id,token=uuid(),time=now(),next=create?1:row.version+1;
 const response={id,version:next,updatedAt:time,reviewFlags:project.reviews,role:row.role||'owner',workflowStatus:status,modelMeta:{reviews:project.reviews,revision:project.revision,updatedAt:project.updatedAt,history:project.history}};
 let first;
 if(create)first=ctx.db.prepare('INSERT INTO projects (id,owner_id,name,phase,payload,asset_key,asset_hash,version,created_at,updated_at,normalized_version,mutation_token,workflow_status,site_width,site_height,source,model_revision,required_area,active_task_id,selected_yard_id) SELECT ?,?,?,?,?,?,?,1,?,?,1,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM projects WHERE owner_id=?) < 30')
 .bind(id,ctx.user.userId,project.name,project.phase,JSON.stringify(project),asset.key,asset.hash,time,time,token,status,...metadataValues(project),ctx.user.userId);
 else first=ctx.db.prepare('UPDATE projects SET name=?,phase=?,payload=?,asset_key=?,asset_hash=?,version=version+1,updated_at=?,normalized_version=version+1,mutation_token=?,workflow_status=?,site_width=?,site_height=?,source=?,model_revision=?,required_area=?,active_task_id=?,selected_yard_id=? WHERE id=? AND version=? AND archived_at IS NULL AND (owner_id=? OR EXISTS (SELECT 1 FROM project_members WHERE project_id=? AND user_id=? AND role=\'editor\'))')
 .bind(project.name,project.phase,JSON.stringify(project),asset.key,asset.hash,time,token,status,...metadataValues(project),id,row.version,ctx.user.userId,id,ctx.user.userId);
 const statements=[first];
 if(!create&&row.normalized_version!==row.version)statements.push(snapshotStatement(ctx,id,token,row.version,validate(JSON.parse(row.payload)),row.asset_key,row.asset_hash,'legacy_snapshot',null,row.updated_at));
 statements.push(...relationStatements(ctx,id,token,project,reviewRecords),snapshotStatement(ctx,id,token,next,project,asset.key,asset.hash,action),auditStatement(ctx,id,action,{version:next},gate,[id,token]));
 if(next>30){
  statements.push(ctx.db.prepare(`INSERT OR IGNORE INTO asset_gc (key,project_id,created_at) SELECT asset_key,project_id,? FROM project_versions WHERE project_id=? AND version<=? AND asset_key IS NOT NULL AND ${gate}`).bind(time,id,next-30,id,token));
  statements.push(ctx.db.prepare(`DELETE FROM project_versions WHERE project_id=? AND version<=? AND ${gate}`).bind(id,next-30,id,token));
 }
 const idem=idempotencyStatement(ctx,response,create?201:200,gate,[id,token]);if(idem)statements.push(idem);
 const result=await ctx.db.batch(statements);
 if(!result[0].meta.changes)fail(409,create?'账号最多保存 30 个项目（含归档）':'云端版本或访问权限已变化，请重新载入','VERSION_CONFLICT');
 return response;
}
export async function simpleMutation(ctx,row,{archivedAt,status,action}){
 const token=uuid(),time=now(),next=row.version+1;
 const response={id:row.id,version:next,archivedAt,workflowStatus:status||row.workflow_status};
 const statements=[ctx.db.prepare('UPDATE projects SET version=version+1,normalized_version=version+1,archived_at=?,workflow_status=?,updated_at=?,mutation_token=? WHERE id=? AND version=? AND owner_id=?')
 .bind(archivedAt,status||row.workflow_status,time,token,row.id,row.version,ctx.user.userId),
 ctx.db.prepare(`INSERT INTO project_versions (project_id,version,payload,asset_key,asset_hash,action,actor_id,created_at) SELECT id,version,payload,asset_key,asset_hash,?,?,? FROM projects WHERE id=? AND ${gate}`).bind(action,ctx.user.userId,time,row.id,row.id,token),
 auditStatement(ctx,row.id,action,{version:next},gate,[row.id,token])];
 if(next>30){
  statements.push(ctx.db.prepare(`INSERT OR IGNORE INTO asset_gc (key,project_id,created_at) SELECT asset_key,project_id,? FROM project_versions WHERE project_id=? AND version<=? AND asset_key IS NOT NULL AND ${gate}`).bind(time,row.id,next-30,row.id,token));
  statements.push(ctx.db.prepare(`DELETE FROM project_versions WHERE project_id=? AND version<=? AND ${gate}`).bind(row.id,next-30,row.id,token));
 }
 const idem=idempotencyStatement(ctx,response,200,gate,[row.id,token]);if(idem)statements.push(idem);
 const result=await ctx.db.batch(statements);if(!result[0].meta.changes)fail(409,'项目已有更新，请重新载入','VERSION_CONFLICT');return response;
}
