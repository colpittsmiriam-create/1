import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {projectApi} from '../lib/project-api.mjs';
import Core from '../lib/core.cjs';
function fixture(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('../drizzle/0000_ordinary_red_hulk.sql',import.meta.url),'utf8').replaceAll('--> statement-breakpoint',''));
 const DB={prepare(sql){return {values:[],bind(...values){this.values=values;return this;},async first(){return sqlite.prepare(sql).get(...this.values)||null;},async all(){return {results:sqlite.prepare(sql).all(...this.values)};},async run(){const r=sqlite.prepare(sql).run(...this.values);return {meta:{changes:Number(r.changes)}};}};}};
 const objects=new Map(),BUCKET={async put(key,data,options){objects.set(key,{data:new Uint8Array(data),type:options.httpMetadata.contentType});},async get(key){const value=objects.get(key);return value?{arrayBuffer:async()=>value.data.buffer,httpMetadata:{contentType:value.type}}:null;},async delete(key){objects.delete(key);}};
 const env={DB,BUCKET},alice={userId:'alice',displayName:'Alice',email:'alice@example.test'},bob={userId:'bob',displayName:'Bob',email:'bob@example.test'};
 const call=async(path,method='GET',body,user=alice,version=null,origin='https://test.example')=>{
  const request=new Request('https://test.example/api/'+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(version?{'If-Match':`"${version}"`}:{}),Origin:origin},...(body?{body:JSON.stringify(body)}:{})});
  const response=await projectApi(request,env,user,path.split('?')[0].split('/'));return {status:response.status,data:await response.json()};
 };
 return {call,objects,sqlite,alice,bob};
}
test('匿名可取会话与健康状态，不能读写云端项目',async()=>{
 const f=fixture();assert.equal((await f.call('session','GET',null,null)).data.user,null);assert.equal((await f.call('health')).status,200);
 assert.equal((await f.call('projects','GET',null,null)).status,401);assert.equal((await f.call('projects','POST',{project:Core.createProject()},null)).status,401);
});
test('账号隔离：另一账号不能列出、读取、修改、删除他人项目',async()=>{
 const f=fixture(),created=await f.call('projects','POST',{project:Core.createProject()});assert.equal(created.status,201);
 const id=created.data.id;assert.equal((await f.call('projects','GET',null,f.bob)).data.projects.length,0);
 for(const [method,body]of [['GET',null],['PUT',{project:Core.createProject()}],['DELETE',null]])assert.equal((await f.call('projects/'+id,method,body,f.bob,1)).status,404);
});
test('服务器验证模型，拒绝跨站请求、非法数据和缺失版本',async()=>{
 const f=fixture();assert.equal((await f.call('projects','POST',{project:Core.createProject()},f.alice,null,'https://evil.test')).status,403);
 const p=Core.createProject();p.edges[0].from='BAD';assert.equal((await f.call('projects','POST',{project:p})).status,422);
 const {data}=await f.call('projects','POST',{project:Core.createProject()});assert.equal((await f.call('projects/'+data.id,'PUT',{project:Core.createProject()})).status,428);
});
test('并发保存只接受一个相同基础版本；服务器计算读取新路网',async()=>{
 const f=fixture(),{data}=await f.call('projects','POST',{project:Core.createProject()}),p=Core.createProject();p.edges[8].closed=true;
 const a=await f.call('projects/'+data.id,'PUT',{project:p},f.alice,1),b=await f.call('projects/'+data.id,'PUT',{project:Core.createProject()},f.alice,1);
 assert.equal(a.status,200);assert.equal(b.status,409);assert.equal((await f.call('projects/'+data.id+'/calculate')).data.result.distance,160);
 assert.equal((await f.call('projects/'+data.id)).data.version,2);
});
test('底图独立持久化并完整恢复，更换/删除时清理旧文件',async()=>{
 const f=fixture(),p=Core.createProject();p.background='data:image/png;base64,YWJj';const {data}=await f.call('projects','POST',{project:p});assert.equal(f.objects.size,1);
 assert.equal((await f.call('projects/'+data.id)).data.project.background,p.background);
 p.background='data:image/webp;base64,ZGVm';await f.call('projects/'+data.id,'PUT',{project:p},f.alice,1);assert.equal(f.objects.size,1);
 p.background=null;await f.call('projects/'+data.id,'PUT',{project:p},f.alice,2);assert.equal(f.objects.size,0);
});
test('归档可恢复，永久删除要求先归档，删除同样使用版本检查',async()=>{
 const f=fixture(),{data}=await f.call('projects','POST',{project:Core.createProject()}),id=data.id;
 assert.equal((await f.call('projects/'+id+'/permanent','DELETE',null,f.alice,1)).status,409);
 assert.equal((await f.call('projects/'+id,'DELETE',null,f.alice,1)).status,200);
 assert.equal((await f.call('projects')).data.projects.length,0);assert.equal((await f.call('projects?archived=1')).data.projects.length,1);
 assert.equal((await f.call('projects/'+id+'/restore','POST',null,f.alice,2)).status,200);
 await f.call('projects/'+id,'DELETE',null,f.alice,3);
 assert.equal((await f.call('projects/'+id+'/permanent','DELETE',null,f.alice,3)).status,409);
 assert.equal((await f.call('projects/'+id+'/permanent','DELETE',null,f.alice,4)).status,200);assert.equal((await f.call('projects?archived=1')).data.projects.length,0);
});
test('错误内容类型与损坏 JSON 返回明确错误',async()=>{
 const f=fixture();const response=await projectApi(new Request('https://test.example/api/projects',{method:'POST',headers:{Origin:'https://test.example','Content-Type':'application/json'},body:'{bad'}),{DB:{prepare:()=>({bind:()=>({run:async()=>({meta:{changes:1}})})})},BUCKET:{}},f.alice,['projects']);
 assert.equal(response.status,400);
});
test('单账号项目数量限制在服务端执行',async()=>{
 const f=fixture();for(let i=0;i<30;i++)assert.equal((await f.call('projects','POST',{project:Core.createProject()})).status,201);
 assert.equal((await f.call('projects','POST',{project:Core.createProject()})).status,409);
});
