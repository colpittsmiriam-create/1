export class HttpError extends Error {
 constructor(status,message,code='REQUEST_FAILED',details){super(message);this.status=status;this.code=code;this.details=details;}
}
export function fail(status,message,code,details){throw new HttpError(status,message,code,details);}
export const now=()=>new Date().toISOString();
export const uuid=()=>crypto.randomUUID();
export const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json;charset=utf-8'}});
export const bytes=text=>new TextEncoder().encode(text).byteLength;
export async function digest(text){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(n=>n.toString(16).padStart(2,'0')).join('');}
export function version(request){const raw=request.headers.get('If-Match');if(!raw||!/^"\d{1,12}"$/.test(raw))fail(428,'缺少有效的项目版本号，请重新载入后重试','VERSION_REQUIRED');return Number(raw.slice(1,-1));}
export function pageOf(url,max=100){
 const params=new URL(url).searchParams,limit=Number(params.get('limit')||25),offset=Number(params.get('offset')||0);
 if(!Number.isInteger(limit)||limit<1||limit>max||!Number.isInteger(offset)||offset<0||offset>100000)fail(400,'分页参数无效','INVALID_PAGINATION');
 return {limit,offset};
}
export const pageResult=(items,total,{limit,offset})=>({items,total,limit,offset,nextOffset:offset+items.length<total?offset+items.length:null});
async function readBody(request){
 if(request.method==='GET'||request.method==='HEAD')return {value:{},text:''};
 const declared=Number(request.headers.get('Content-Length')||0);
 if(declared>4*1024*1024)fail(413,'请求过大，底图最大 2 MB，模型正文最大 900 KB','TOO_LARGE');
 if(!request.body)return {value:{},text:''};
 const isJson=request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json');
 if(!isJson&&declared>0)fail(415,'请求必须使用 application/json','BAD_CONTENT_TYPE');
 const reader=request.body.getReader(),chunks=[];let size=0,timer;
 try{
  const reading=(async()=>{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>4*1024*1024){await reader.cancel();fail(413,'请求内容超过大小限制','TOO_LARGE');}chunks.push(value);}})();
  await Promise.race([reading,new Promise((_,reject)=>{timer=setTimeout(()=>{reader.cancel().catch(()=>{});reject(new HttpError(408,'请求读取超时','REQUEST_TIMEOUT'));},12000);})]);
 }finally{clearTimeout(timer);reader.releaseLock();}
 if(size===0)return {value:{},text:''};
 if(!isJson)fail(415,'请求必须使用 application/json','BAD_CONTENT_TYPE');
 const body=new Uint8Array(size);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}
 const text=new TextDecoder().decode(body);let value;try{value=JSON.parse(text);}catch{fail(400,'JSON 格式不正确','BAD_JSON');}
 if(!value||typeof value!=='object'||Array.isArray(value))fail(400,'请求内容必须为 JSON 对象','INVALID_BODY');
 return {value,text};
}
async function ensureUser(ctx){
 const user=ctx.user,time=now();
 await ctx.db.prepare('INSERT INTO user_accounts (id,email,display_name,created_at,last_seen_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,display_name=excluded.display_name,last_seen_at=excluded.last_seen_at WHERE last_seen_at < ? OR email != excluded.email OR display_name != excluded.display_name')
 .bind(user.userId,String(user.email||'').toLowerCase(),user.displayName||user.email||'用户',time,time,new Date(Date.now()-300000).toISOString()).run();
}
async function replay(ctx){
 if(!ctx.idempotency)return null;
 const row=await ctx.db.prepare('SELECT request_hash,response,status FROM api_idempotency WHERE owner_id=? AND key=?').bind(ctx.user.userId,ctx.idempotency.key).first();
 if(!row)return null;
 if(row.request_hash!==ctx.idempotency.hash)fail(409,'同一请求标识不能用于不同操作','IDEMPOTENCY_CONFLICT');
 const projectId=new URL(ctx.request.url).pathname.match(/^\/api\/projects\/([0-9a-f-]{36})(?:\/|$)/)?.[1];
 if(projectId){
  const access=await ctx.db.prepare('SELECT p.owner_id,m.role FROM projects p LEFT JOIN project_members m ON m.project_id=p.id AND m.user_id=? WHERE p.id=?').bind(ctx.user.userId,projectId).first();
  const result=JSON.parse(row.response);
  if(!access&&!result.deleted)fail(404,'项目不存在或权限已移除','NOT_FOUND');
  if(access&&access.owner_id!==ctx.user.userId&&access.role!=='editor')fail(403,'当前账号已没有编辑权限','FORBIDDEN');
 }
 const response=json(JSON.parse(row.response),row.status);response.headers.set('Idempotency-Replayed','true');return response;
}
async function limit(ctx){
 const write=!['GET','HEAD'].includes(ctx.request.method),period=write?3600000:60000,maximum=write?240:300,window=Math.floor(Date.now()/period),key=(write?'write:':'read:')+ctx.user.userId;
 const result=await ctx.db.prepare('INSERT INTO api_rate_limits (key,window_id,count) VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window_id=excluded.window_id THEN count+1 ELSE 1 END,window_id=excluded.window_id WHERE window_id!=excluded.window_id OR count < ?').bind(key,window,maximum).run();
 ctx.rate={limit:maximum,reset:Math.ceil(((window+1)*period-Date.now())/1000)};
 if(result.meta.changes!==1)fail(429,'请求较频繁，请稍后重试；未同步内容可先下载备份','RATE_LIMIT');
}
function headersFor(response,ctx){
 const headers=new Headers(response.headers);
 headers.set('X-Request-Id',ctx.requestId);headers.set('Cache-Control','private, no-store');headers.set('X-Content-Type-Options','nosniff');
 headers.set('Referrer-Policy','strict-origin-when-cross-origin');headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
 headers.set('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
 headers.set('Vary','Cookie, OAI-Authenticated-User-Id');
 if(ctx.etag)headers.set('ETag',`"${ctx.etag}"`);
 if(ctx.rate){headers.set('RateLimit-Limit',String(ctx.rate.limit));headers.set('RateLimit-Reset',String(ctx.rate.reset));if(response.status===429)headers.set('Retry-After',String(ctx.rate.reset));}
 return new Response(response.body,{status:response.status,headers});
}
export async function middleware(request,env,user,handler){
 const started=Date.now(),ctx={request,env,user,requestId:uuid(),db:env.DB?.withSession?env.DB.withSession('first-primary'):env.DB,afterCommit:[],idempotency:null};
 let response;
 try{
  const url=new URL(request.url),publicRoute=request.method==='GET'&&['/api/session','/api/health','/api/openapi'].includes(url.pathname.replace(/\/$/,''));
  if(!publicRoute&&!user?.userId)fail(401,'请先登录后访问云端业务','AUTH_REQUIRED');
  if(!env.DB||!env.BUCKET){if(url.pathname!=='/api/session')fail(503,'云端存储尚未就绪','STORAGE_UNAVAILABLE');}
  if(!['GET','HEAD','OPTIONS'].includes(request.method)){
   if(request.headers.get('Origin')!==url.origin||request.headers.get('Sec-Fetch-Site')==='cross-site')fail(403,'请求来源不受信任，请从本站页面操作','BAD_ORIGIN');
  }
  if(user?.userId&&ctx.db){await ensureUser(ctx);}
  const body=await readBody(request);ctx.body=body.value;
  const key=request.headers.get('Idempotency-Key');
  if(key&&!['GET','HEAD'].includes(request.method)){
   if(!/^[A-Za-z0-9_-]{8,100}$/.test(key))fail(400,'请求标识应为 8 至 100 位字母、数字、横线或下划线','INVALID_IDEMPOTENCY_KEY');
   ctx.idempotency={key,hash:await digest(request.method+' '+url.pathname+' '+(request.headers.get('If-Match')||'')+' '+body.text)};
   response=await replay(ctx);
  }
  if(!response){if(user?.userId&&!publicRoute)await limit(ctx);response=await handler(ctx);}
 }catch(error){
  // A concurrent identical write may have committed its idempotency record.
  if(ctx.idempotency){try{response=await replay(ctx);}catch(replayError){error=replayError;}}
  if(!response)response=json({error:error instanceof HttpError?error.message:'服务暂时不可用，请稍后重试',code:error instanceof HttpError?error.code:'SERVICE_UNAVAILABLE',requestId:ctx.requestId,...(error instanceof HttpError&&error.details?{details:error.details}:{})},error instanceof HttpError?error.status:503);
 }
 for(const work of ctx.afterCommit){try{await work();}catch{/* Deferred cleanup can retry on the next write. */}}
 const log={event:'api_request',requestId:ctx.requestId,method:request.method,path:new URL(request.url).pathname,status:response.status,durationMs:Date.now()-started};
 if(env.API_LOGGER)env.API_LOGGER(log);else console.log(JSON.stringify(log));
 return headersFor(response,ctx);
}
export function idempotencyStatement(ctx,response,status,guardSql,guardValues=[]){
 if(!ctx.idempotency)return null;
 return ctx.db.prepare('INSERT INTO api_idempotency (owner_id,key,request_hash,response,status,created_at) SELECT ?,?,?,?,?,? WHERE '+guardSql)
 .bind(ctx.user.userId,ctx.idempotency.key,ctx.idempotency.hash,JSON.stringify(response),status,now(),...guardValues);
}
