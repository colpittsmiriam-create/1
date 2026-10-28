import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers.mjs';
import Core from '../lib/core.cjs';
const make=async f=>(await f.call('projects','POST',{project:Core.createProject()})).data;
test('业务实体真实写入关系表，读取与计算不依赖兼容 JSON 的道路数组',async()=>{
 const f=fixture(),p=await make(f),id=p.id;
 for(const [table,count]of [['site_nodes',12],['site_roads',16],['transport_tasks',3],['storage_yards',3],['road_restrictions',1],['restriction_roads',1],['project_reviews',3]])assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM '+table+' WHERE project_id=?').get(id).n,count);
 const cached=Core.createProject();cached.edges.forEach(e=>e.length=999);f.sqlite.prepare('UPDATE projects SET payload=? WHERE id=?').run(JSON.stringify(cached),id);
 assert.equal((await f.call('projects/'+id+'/calculate')).data.result.distance,100);
});
test('节点、道路和任务 CRUD 通过服务端校验与联动计算',async()=>{
 const f=fixture(),p=await make(f),root='projects/'+p.id;
 const closed=await f.call(root+'/roads/R09','PATCH',{closed:true},f.alice,1);assert.equal(closed.status,200);assert.equal((await f.call(root+'/calculate')).data.result.distance,160);
 assert.equal((await f.call(root+'/nodes/A','DELETE',null,f.alice,2)).status,422);assert.equal((await f.call(root)).data.version,2);
 const t={...Core.createProject().tasks[0],id:'T04',name:'新搬运任务'};assert.equal((await f.call(root+'/tasks','POST',t,f.alice,2)).status,200);
 assert.equal((await f.call(root+'/tasks?limit=2&offset=2')).data.total,4);
 assert.equal((await f.call(root+'/tasks/T04','DELETE',null,f.alice,3)).status,200);
 assert.equal((await f.call(root+'/tasks/T04')).status,404);
});
test('并发事务的失败方不删除或覆盖成功方的业务行',async()=>{
 const f=fixture(),p=await make(f),root='projects/'+p.id;
 const values=await Promise.all([f.call(root+'/roads/R09','PATCH',{closed:true},f.alice,1),f.call(root+'/roads/R01','PATCH',{width:1},f.alice,1)]);
 assert.deepEqual(values.map(v=>v.status).sort(),[200,409]);
 const saved=(await f.call(root)).data;assert.equal(saved.version,2);assert.equal(saved.project.edges.length,16);
 if(values[0].status===200){assert.equal(saved.project.edges.find(e=>e.id==='R09').closed,true);assert.equal(saved.project.edges[0].width,4.5);}else{assert.equal(saved.project.edges[0].width,1);assert.equal(saved.project.edges[8].closed,false);}
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM project_versions WHERE project_id=?').get(p.id).n,2);
});
test('事务中途失败会回滚项目版本与所有业务表，并移除未提交的底图',async()=>{
 const f=fixture(),p=await make(f),model=(await f.call('projects/'+p.id)).data.project;model.name='不应提交';model.background='data:image/png;base64,YWJj';
 f.DB.failWhen=sql=>sql.startsWith('INSERT INTO transport_tasks');
 assert.equal((await f.call('projects/'+p.id,'PUT',{project:model},f.alice,1)).status,503);f.DB.failWhen=null;
 const saved=(await f.call('projects/'+p.id)).data;assert.equal(saved.version,1);assert.notEqual(saved.project.name,'不应提交');assert.equal(saved.project.edges.length,16);assert.equal(f.objects.size,0);
});
test('旧版项目按需迁移且不增加业务版本、不丢失原场地尺寸',async()=>{
 const f=fixture(),id=crypto.randomUUID(),p=Core.createProject();p.siteWidth=200;p.name='旧版数据';
 f.sqlite.prepare('INSERT INTO projects (id,owner_id,name,phase,payload,version,created_at,updated_at) VALUES (?,?,?,?,?,5,?,?)').run(id,'alice',p.name,p.phase,JSON.stringify(p),p.updatedAt,p.updatedAt);
 const response=await f.call('projects/'+id);assert.equal(response.status,200);assert.equal(response.data.version,5);assert.equal(response.data.project.siteWidth,200);
 assert.equal(f.sqlite.prepare('SELECT normalized_version FROM projects WHERE id=?').get(id).normalized_version,5);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM site_nodes WHERE project_id=?').get(id).n,12);
 assert.equal((await f.call('projects/'+id+'/versions')).data.items[0].version,5);
});
test('查看者能读取但不能改项目，编辑者能修改但不能归档或管理成员',async()=>{
 const f=fixture(),p=await make(f),root='projects/'+p.id;
 await f.call('session','GET',null,f.bob);
 assert.equal((await f.call(root+'/members','POST',{email:f.bob.email,role:'viewer'})).status,200);
 assert.equal((await f.call('projects','GET',null,f.bob)).data.projects[0].role,'viewer');assert.equal((await f.call(root,'GET',null,f.bob)).status,200);
 for(const [path,method,body] of [[root+'/roads/R09','PATCH',{closed:true}],[root,'PUT',{project:Core.createProject()}],[root,'DELETE',null],[root+'/approve','POST',null]])assert.equal((await f.call(path,method,body,f.bob,1)).status,403);
 await f.call(root+'/members','POST',{email:f.bob.email,role:'editor'});
 assert.equal((await f.call(root+'/roads/R09','PATCH',{closed:true},f.bob,1)).status,200);
 assert.equal((await f.call(root,'DELETE',null,f.bob,2)).status,403);
 assert.equal((await f.call(root+'/members','POST',{email:f.alice.email,role:'viewer'},f.bob)).status,403);
 await f.call(root+'/members/bob','DELETE');assert.equal((await f.call(root,'GET',null,f.bob)).status,404);
});
test('持久化幂等键可重放同一创建响应，同键不同内容拒绝',async()=>{
 const f=fixture(),body={project:Core.createProject()},headers={'Idempotency-Key':'create-project-1234'};
 const a=await f.call('projects','POST',body,f.alice,null,'https://test.example',headers),b=await f.call('projects','POST',body,f.alice,null,'https://test.example',headers);
 assert.equal(a.status,201);assert.equal(b.status,201);assert.deepEqual(a.data,b.data);assert.equal(b.headers.get('Idempotency-Replayed'),'true');
 body.project.name='另一个请求';assert.equal((await f.call('projects','POST',body,f.alice,null,'https://test.example',headers)).status,409);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM projects').get().n,1);
});
test('服务器计算记录关联输入版本，模型更新后历史结果标记过期',async()=>{
 const f=fixture(),p=await make(f),root='projects/'+p.id,run=await f.call(root+'/planning-runs','POST',{taskId:'T01'},f.alice,1);
 assert.equal(run.status,201);assert.equal(run.data.result.result.distance,100);assert.equal(run.data.result.yards.find(y=>y.id==='S2').route.distance,60);
 assert.equal((await f.call(root+'/planning-runs/'+run.data.id)).data.stale,false);
 await f.call(root+'/roads/R09','PATCH',{closed:true},f.alice,1);
 const previous=await f.call(root+'/planning-runs/'+run.data.id);assert.equal(previous.data.stale,true);assert.equal(previous.data.result.result.distance,100);
 assert.equal((await f.call(root+'/calculate')).data.result.distance,160);
});
test('历史恢复创建新版本，原快照与底图均保持可追溯',async()=>{
 const f=fixture(),model=Core.createProject();model.background='data:image/png;base64,YWJj';const p=(await f.call('projects','POST',{project:model})).data,root='projects/'+p.id;
 model.name='更新后的场地';model.background='data:image/webp;base64,ZGVm';await f.call(root,'PUT',{project:model},f.alice,1);
 const restored=await f.call(root+'/versions/1/restore','POST',{},f.alice,2);assert.equal(restored.status,200);assert.equal(restored.data.version,3);
 const read=(await f.call(root)).data;assert.equal(read.project.background,'data:image/png;base64,YWJj');assert.notEqual(read.project.name,model.name);assert.equal(read.workflowStatus,'draft');
 assert.equal((await f.call(root+'/versions')).data.total,3);assert.equal(f.objects.size,2);
});
test('方案确认由服务器执行状态机，模型修改会清除确认与责任记录',async()=>{
 const f=fixture(),p=await make(f),root='projects/'+p.id;
 assert.equal((await f.call(root+'/approve','POST',{},f.alice,1)).status,409);
 const submitted=await f.call(root+'/submit','POST',{},f.alice,1);assert.equal(submitted.status,200);assert.equal(submitted.data.workflowStatus,'in_review');
 assert.equal((await f.call(root+'/approve','POST',{},f.alice,2)).status,422);
 const model=(await f.call(root)).data.project;model.reviews=[true,true,true];await f.call(root,'PUT',{project:model},f.alice,2);
 const approved=await f.call(root+'/approve','POST',{},f.alice,3);assert.equal(approved.status,200);assert.equal(approved.data.workflowStatus,'approved');
 await f.call(root+'/roads/R09','PATCH',{closed:true},f.alice,4);const updated=(await f.call(root)).data;assert.equal(updated.workflowStatus,'draft');assert.deepEqual(updated.project.reviews,[false,false,false]);
});
test('客户端不能通过导入或编辑时夹带勾选伪造已复核状态',async()=>{
 const f=fixture(),model=Core.createProject();model.reviews=[true,true,true];const p=(await f.call('projects','POST',{project:model})).data;
 assert.deepEqual(p.modelMeta.reviews,[false,false,false]);model.name='已更改模型';
 const updated=await f.call('projects/'+p.id,'PUT',{project:model},f.alice,1);assert.deepEqual(updated.data.modelMeta.reviews,[false,false,false]);
});
test('限流、错误、安全响应头与请求追踪由统一中间件提供',async()=>{
 const f=fixture();f.sqlite.prepare('INSERT INTO api_rate_limits (key,window_id,count) VALUES (?,?,240)').run('write:alice',Math.floor(Date.now()/3600000));
 const response=await f.call('projects','POST',{project:Core.createProject()});assert.equal(response.status,429);assert.ok(Number(response.headers.get('Retry-After'))>0);assert.equal(response.data.requestId,response.headers.get('X-Request-Id'));assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
 assert.equal((await f.call('projects?limit=101')).status,400);
});
test('数据库复合外键阻止跨项目节点引用',async()=>{
 const f=fixture(),a=await make(f),b=await make(f);await f.call('projects/'+b.id+'/nodes','POST',{id:'Z',label:'另一项目的节点',x:1,y:1},f.alice,1);
 assert.throws(()=>f.sqlite.prepare('INSERT INTO site_roads (project_id,road_id,from_node,to_node,length_m,width_m,closed) VALUES (?,?,?,?,?,?,0)').run(a.id,'INVALID','A','Z',10,4));
});
test('版本保留窗口有界，过期版本释放文件，审计只保存操作摘要',async()=>{
 const f=fixture(),model=Core.createProject();model.background='data:image/png;base64,YWJj';const p=(await f.call('projects','POST',{project:model})).data,root='projects/'+p.id;
 model.background=null;model.name='场地_1';assert.equal((await f.call(root,'PUT',{project:model},f.alice,1)).status,200);
 for(let i=2;i<=31;i++)assert.equal((await f.call(root+'/settings','PATCH',{name:'场地_'+i},f.alice,i)).status,200);
 assert.equal(f.objects.size,0);
 const history=(await f.call(root+'/versions?limit=100')).data;assert.equal(history.total,30);assert.equal(history.items.at(-1).version,3);
 const events=(await f.call(root+'/audit-events?limit=100')).data;assert.equal(events.total,32);assert.ok(events.items.every(event=>!JSON.stringify(event.metadata).includes('data:image')));
});
test('真实 HTTP 中的空请求流允许执行无需正文的动作',async()=>{
 const {projectApi}=await import('../lib/project-api.mjs');const f=fixture(),p=await make(f),root='projects/'+p.id;
 await f.call(root,'DELETE',null,f.alice,1);
 const request=new Request('https://test.example/api/'+root+'/restore',{method:'POST',headers:{Origin:'https://test.example','If-Match':'"2"'},body:new ReadableStream({start(controller){controller.close();}}),duplex:'half'});
 const response=await projectApi(request,f.env,f.alice,['projects',p.id,'restore']);assert.equal(response.status,200);
});
test('撤销编辑角色后不能通过幂等响应缓存继续读取此前的写结果',async()=>{
 const f=fixture(),p=await make(f),root='projects/'+p.id;await f.call('session','GET',null,f.bob);await f.call(root+'/members','POST',{email:f.bob.email,role:'editor'});
 const headers={'Idempotency-Key':'edited-road-1234'};assert.equal((await f.call(root+'/roads/R09','PATCH',{closed:true},f.bob,1,'https://test.example',headers)).status,200);
 await f.call(root+'/members/bob','DELETE');assert.equal((await f.call(root+'/roads/R09','PATCH',{closed:true},f.bob,1,'https://test.example',headers)).status,403);
});
