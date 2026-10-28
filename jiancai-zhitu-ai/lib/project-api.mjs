import Core from './engine.mjs';

const MAX_BODY=4*1024*1024, MAX_PAYLOAD=900_000, MAX_PROJECTS=30;
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json;charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
class ApiError extends Error {constructor(status,message,code='REQUEST_FAILED'){super(message);this.status=status;this.code=code;}}
const fail=(status,message,code)=>{throw new ApiError(status,message,code);};
const uuid=()=>crypto.randomUUID();
const validId=id=>typeof id==='string'&&/^[0-9a-f-]{36}$/.test(id);
const bytes=value=>new TextEncoder().encode(value).byteLength;
function assertOrigin(request){
 const origin=request.headers.get('Origin');
 if(origin!==new URL(request.url).origin||request.headers.get('Sec-Fetch-Site')==='cross-site')fail(403,'请求来源不受信任，请从本站页面操作','BAD_ORIGIN');
}
async function readJson(request){
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))fail(415,'请使用 JSON 请求','BAD_CONTENT_TYPE');
 if(Number(request.headers.get('content-length')||0)>MAX_BODY)fail(413,'项目文件过大','TOO_LARGE');
 const reader=request.body?.getReader();if(!reader)fail(400,'请求内容为空','BAD_BODY');
 const chunks=[];let size=0;
 try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BODY){await reader.cancel();fail(413,'项目文件过大','TOO_LARGE');}chunks.push(value);}}
 finally{reader.releaseLock();}
 const buffer=new Uint8Array(size);let offset=0;for(const c of chunks){buffer.set(c,offset);offset+=c.length;}
 try{return JSON.parse(new TextDecoder().decode(buffer));}catch{fail(400,'JSON 格式不正确','BAD_JSON');}
}
async function takeWriteQuota(db,owner){
 const window=Math.floor(Date.now()/3600000);
 const result=await db.prepare('INSERT INTO write_limits (owner_id, window_id, count) VALUES (?, ?, 1) ON CONFLICT(owner_id) DO UPDATE SET count = CASE WHEN window_id = excluded.window_id THEN count + 1 ELSE 1 END, window_id = excluded.window_id WHERE window_id != excluded.window_id OR count < 240').bind(owner,window).run();
 if(result.meta.changes!==1)fail(429,'保存操作较频繁，请稍后重试；可先下载项目备份','RATE_LIMIT');
}
async function rowFor(db,id,owner,includeArchived=false){
 if(!validId(id))fail(404,'项目不存在','NOT_FOUND');
 const row=await db.prepare('SELECT * FROM projects WHERE id = ? AND owner_id = ?'+(includeArchived?'':' AND archived_at IS NULL')).bind(id,owner).first();
 if(!row)fail(404,'项目不存在或你没有访问权限','NOT_FOUND');return row;
}
function expectedVersion(request){const value=request.headers.get('If-Match');if(!value||!/^"\d+"$/.test(value))fail(428,'保存需要项目版本号，请刷新后重试','VERSION_REQUIRED');return Number(value.slice(1,-1));}
async function binaryData(bucket,key){
 if(!key)return null;const object=await bucket.get(key);if(!object)fail(503,'底图暂时无法读取，请稍后重试','ASSET_UNAVAILABLE');
 const data=new Uint8Array(await object.arrayBuffer());let raw='';for(let i=0;i<data.length;i+=8192)raw+=String.fromCharCode(...data.subarray(i,i+8192));
 return `data:${object.httpMetadata?.contentType||'image/png'};base64,${btoa(raw)}`;
}
async function stageProject(env,input,id,current){
 let project;try{project=Core.validate(input);}catch(e){fail(422,e.message,'INVALID_PROJECT');}
 const background=project.background;project.background=null;
 const payload=JSON.stringify(project);if(bytes(payload)>MAX_PAYLOAD)fail(413,'场地模型过大，请减少项目记录后重试','TOO_LARGE');
 let assetKey=current?.asset_key||null,assetHash=current?.asset_hash||null,newAsset=null;
 if(!background){assetKey=null;assetHash=null;}
 else {
  const match=/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(background);
  const raw=atob(match[2]);if(raw.length>2*1024*1024)fail(413,'底图不能超过 2 MB','TOO_LARGE');
  const data=Uint8Array.from(raw,c=>c.charCodeAt(0));
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data))).map(n=>n.toString(16).padStart(2,'0')).join('');
  if(hash!==assetHash){assetKey=`backgrounds/${id}/${uuid()}`;assetHash=hash;await env.BUCKET.put(assetKey,data,{httpMetadata:{contentType:match[1]}});newAsset=assetKey;}
 }
 return {project,payload,assetKey,assetHash,newAsset};
}
async function present(env,row){
 const project=JSON.parse(row.payload);project.background=await binaryData(env.BUCKET,row.asset_key);
 return {id:row.id,version:row.version,project,updatedAt:row.updated_at,archivedAt:row.archived_at};
}
const summary=row=>({id:row.id,name:row.name,phase:row.phase,version:row.version,updatedAt:row.updated_at,archivedAt:row.archived_at});

export async function projectApi(request,env,user,segments=[]){
 try{
  const [resource,id,action]=segments,method=request.method;
  if(resource==='session'&&method==='GET')return json({user:user?{id:user.userId,name:user.displayName,email:user.email}:null,storageReady:!!env.DB&&!!env.BUCKET,signIn:'/signin-with-chatgpt?return_to=%2F',signOut:'/signout-with-chatgpt?return_to=%2F'});
  if(resource==='health'&&method==='GET'){
   if(!env.DB||!env.BUCKET)return json({status:'unavailable'},503);
   await env.DB.prepare('SELECT 1 FROM projects LIMIT 1').first();return json({status:'ok',version:'3.0'});
  }
  if(resource!=='projects')fail(404,'接口不存在','NOT_FOUND');
  if(!user?.userId)fail(401,'请先登录，再保存或读取云端项目','AUTH_REQUIRED');
  if(!env.DB||!env.BUCKET)fail(503,'云端存储尚未就绪，请稍后重试','STORAGE_UNAVAILABLE');
  const owner=user.userId,db=env.DB;
  if(!['GET','HEAD'].includes(method)){assertOrigin(request);await takeWriteQuota(db,owner);}
  if(!id&&method==='GET'){
   const archived=new URL(request.url).searchParams.get('archived')==='1';
   const data=await db.prepare('SELECT id, name, phase, version, updated_at, archived_at FROM projects WHERE owner_id = ? AND archived_at IS '+(archived?'NOT NULL':'NULL')+' ORDER BY updated_at DESC LIMIT 30').bind(owner).all();
   return json({projects:data.results.map(summary),limit:MAX_PROJECTS});
  }
  if(!id&&method==='POST'){
   const input=await readJson(request),newId=uuid(),now=new Date().toISOString();
   const count=await db.prepare('SELECT COUNT(*) AS n FROM projects WHERE owner_id = ?').bind(owner).first();if(count.n>=MAX_PROJECTS)fail(409,'账号最多保存 30 个项目（含已归档），请先下载备份并永久删除不再使用的项目','PROJECT_LIMIT');
   const staged=await stageProject(env,input.project,newId,null);
   try{
    const result=await db.prepare('INSERT INTO projects (id, owner_id, name, phase, payload, asset_key, asset_hash, version, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ?, ?, 1, ?, ? WHERE (SELECT COUNT(*) FROM projects WHERE owner_id = ?) < ?').bind(newId,owner,staged.project.name,staged.project.phase,staged.payload,staged.assetKey,staged.assetHash,now,now,owner,MAX_PROJECTS).run();
    if(!result.meta.changes)fail(409,'项目数量已达上限','PROJECT_LIMIT');
   }catch(e){if(staged.newAsset)await env.BUCKET.delete(staged.newAsset);throw e;}
   return json({id:newId,version:1,updatedAt:now},201);
  }
  const row=await rowFor(db,id,owner,action==='restore'||(method==='DELETE'&&action==='permanent'));
  if(method==='GET'&&!action)return json(await present(env,row));
  if(method==='GET'&&action==='calculate'){
   const p=Core.validate(JSON.parse(row.payload)),task=p.tasks.find(t=>t.id===p.activeTaskId);
   return json({id,version:row.version,taskId:task?.id||null,result:Core.route(p,task),issues:Core.issues(p),fieldVerified:false});
  }
  if(method==='PUT'&&!action){
   const expected=expectedVersion(request);if(expected!==row.version)fail(409,'云端项目已有更新，请先保留本地备份并重新载入','VERSION_CONFLICT');
   const input=await readJson(request),staged=await stageProject(env,input.project,id,row),now=new Date().toISOString();
   const result=await db.prepare('UPDATE projects SET name = ?, phase = ?, payload = ?, asset_key = ?, asset_hash = ?, version = version + 1, updated_at = ? WHERE id = ? AND owner_id = ? AND version = ? AND archived_at IS NULL').bind(staged.project.name,staged.project.phase,staged.payload,staged.assetKey,staged.assetHash,now,id,owner,expected).run();
   if(!result.meta.changes){if(staged.newAsset)await env.BUCKET.delete(staged.newAsset);fail(409,'另一个窗口刚刚更新了项目，请先备份本地修改并重新载入','VERSION_CONFLICT');}
   if(row.asset_key&&row.asset_key!==staged.assetKey)await env.BUCKET.delete(row.asset_key).catch(()=>{});
   return json({id,version:row.version+1,updatedAt:now});
  }
  if((method==='DELETE'&&!action)||(method==='POST'&&action==='restore')){
   const expected=expectedVersion(request),now=new Date().toISOString();
   const result=await db.prepare('UPDATE projects SET archived_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND owner_id = ? AND version = ?').bind(action==='restore'?null:now,now,id,owner,expected).run();
   if(!result.meta.changes)fail(409,'项目已有更新，请重新载入','VERSION_CONFLICT');
   return json({id,version:row.version+1,archivedAt:action==='restore'?null:now});
  }
  if(method==='DELETE'&&action==='permanent'){
   if(!row.archived_at)fail(409,'请先归档项目，再执行永久删除','ARCHIVE_REQUIRED');
   const expected=expectedVersion(request);
   const result=await db.prepare('DELETE FROM projects WHERE id = ? AND owner_id = ? AND version = ? AND archived_at IS NOT NULL').bind(id,owner,expected).run();
   if(!result.meta.changes)fail(409,'项目已有更新，请重新载入','VERSION_CONFLICT');
   if(row.asset_key)await env.BUCKET.delete(row.asset_key).catch(()=>{});return json({deleted:true});
  }
  fail(405,'不支持此操作','METHOD_NOT_ALLOWED');
 }catch(error){
  if(error instanceof ApiError)return json({error:error.message,code:error.code},error.status);
  console.error('project_api_failure',error?.name,error?.message?.slice(0,160));
  return json({error:'服务暂时不可用，修改仍可下载备份，请稍后重试',code:'SERVICE_UNAVAILABLE'},503);
 }
}
