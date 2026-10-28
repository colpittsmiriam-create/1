import {fail,now} from '../http/middleware.mjs';
export async function stageAsset(ctx,projectId,background,current){
 if(!background)return {key:null,hash:null,staged:null};
 const match=/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(background);let raw;
 try{if(!match)throw Error();raw=atob(match[2]);}catch{fail(422,'底图编码无效','INVALID_IMAGE');}
 if(raw.length>2*1024*1024)fail(413,'底图不能超过 2 MB','TOO_LARGE');
 const data=Uint8Array.from(raw,c=>c.charCodeAt(0)),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data))).map(n=>n.toString(16).padStart(2,'0')).join('');
 if(hash===current?.asset_hash)return {key:current.asset_key,hash,staged:null};
 const key=`backgrounds/${projectId}/${crypto.randomUUID()}`;
 await ctx.env.BUCKET.put(key,data,{httpMetadata:{contentType:match[1]}});return {key,hash,staged:key};
}
export async function imageFor(ctx,key){
 if(!key)return null;const image=await ctx.env.BUCKET.get(key);if(!image)fail(503,'底图暂时不可读取，请重试','ASSET_UNAVAILABLE');
 const data=new Uint8Array(await image.arrayBuffer());let raw='';for(let i=0;i<data.length;i+=8192)raw+=String.fromCharCode(...data.subarray(i,i+8192));
 return `data:${image.httpMetadata?.contentType||'image/png'};base64,${btoa(raw)}`;
}
export async function garbageCollect(ctx,id,maximum=5){
 for(let processed=0;processed<maximum;processed+=5){
  const rows=(await ctx.db.prepare('SELECT key FROM asset_gc WHERE project_id=? LIMIT 5').bind(id).all()).results;if(!rows.length)break;
  const references=await ctx.db.batch(rows.map(row=>ctx.db.prepare('SELECT id FROM projects WHERE asset_key=? UNION ALL SELECT project_id AS id FROM project_versions WHERE asset_key=? LIMIT 1').bind(row.key,row.key)));
  const results=await Promise.allSettled(rows.map((row,index)=>references[index].results.length?Promise.resolve():ctx.env.BUCKET.delete(row.key)));
  const cleared=rows.filter((_,index)=>results[index].status==='fulfilled');if(!cleared.length)break;
  await ctx.db.batch(cleared.map(row=>ctx.db.prepare('DELETE FROM asset_gc WHERE key=?').bind(row.key)));
  if(rows.length<5)break;
 }
 // Idempotency keys protect retries for a rolling 24-hour interval.
 await ctx.db.prepare('DELETE FROM api_idempotency WHERE owner_id=? AND created_at<?').bind(ctx.user.userId,new Date(Date.now()-86400000).toISOString()).run();
}
export async function retryDeletedAssets(ctx){
 const pending=await ctx.db.prepare("SELECT g.project_id FROM asset_gc g JOIN audit_events a ON a.project_id=g.project_id AND a.action='project_deleted' WHERE a.actor_id=? LIMIT 1").bind(ctx.user.userId).first();
 if(pending)await garbageCollect(ctx,pending.project_id,40);
}
