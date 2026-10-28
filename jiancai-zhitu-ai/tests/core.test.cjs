const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../lib/core.cjs');
test('示范路线正常100米，封路160米，过宽无解',()=>{
 const p=C.createProject();assert.equal(C.route(p,p.tasks[0]).distance,100);
 p.edges.find(e=>e.id==='R09').closed=true;assert.equal(C.route(p,p.tasks[0]).distance,160);
 p.tasks[0].width=5;assert.equal(C.route(p,p.tasks[0]).distance,null);
});
test('道路编辑及新增节点直接参与路线计算',()=>{
 const p=C.createProject();p.nodes.push({id:'M',label:'新作业面',x:90,y:50});p.edges.push({id:'R17',from:'A',to:'M',length:15,width:4,closed:false},{id:'R18',from:'M',to:'L',length:10,width:4,closed:false});
 assert.equal(C.route(C.validate(p),p.tasks[0]).distance,25);
 p.edges.at(-1).width=1;assert.equal(C.route(p,p.tasks[0]).distance,100);
});
test('最短路与独立全源算法对照所有节点组合',()=>{
 const p=C.createProject(),ids=p.nodes.map(n=>n.id),d=ids.map((a,i)=>ids.map((b,j)=>i===j?0:Infinity));
 for(const e of p.edges){const i=ids.indexOf(e.from),j=ids.indexOf(e.to);d[i][j]=d[j][i]=e.length;}
 for(let k=0;k<ids.length;k++)for(let i=0;i<ids.length;i++)for(let j=0;j<ids.length;j++)d[i][j]=Math.min(d[i][j],d[i][k]+d[k][j]);
 ids.forEach((a,i)=>ids.forEach((b,j)=>assert.equal(C.search(p,a,b).distance,d[i][j])));
});
test('时窗重叠封路，边界相接不封路',()=>{
 const p=C.createProject(),t=p.tasks[0];assert.equal(C.route(p,t).distance,100);
 p.restrictions[0].start='09:00';assert.equal(C.route(p,t).distance,160);
 p.restrictions[0].start=t.windowEnd;assert.equal(C.route(p,t).distance,100);
});
test('检查共享设备冲突、时长超限及无可行路线',()=>{
 const p=C.createProject();p.tasks[1].resource=p.tasks[0].resource;p.tasks[1].windowStart='08:30';
 assert.ok(C.issues(p).some(i=>i.title==='设备时窗冲突'));
 p.tasks[0].trips=1000;assert.ok(C.issues(p).some(i=>i.title.includes('超出配送时窗')));
 p.tasks[0].width=10;assert.ok(C.issues(p).some(i=>i.title.includes('无可行路线')));
});
test('堆场使用路网距离与面积，成本含投入而非按距离盲选',()=>{
 const p=C.createProject(),rows=C.compareYards(p,p.tasks[0]);assert.equal(rows.find(y=>y.id==='S2').route.distance,60);
 assert.equal(rows.find(y=>y.id==='S1').route.distance,100);assert.equal(rows[0].id,'S1');
 assert.equal(rows.find(y=>y.id==='S3').eligible,false);p.requiredArea=200;assert.ok(C.compareYards(p,p.tasks[0]).every(y=>!y.eligible));
});
test('完整备份无损恢复，包括底图与复核',()=>{
 const p=C.createProject();p.background='data:image/png;base64,YQ==';p.reviews=[true,true,true];
 const restored=C.validate(JSON.parse(JSON.stringify(C.backup(p))).project);assert.deepEqual(restored,p);
});
test('新版本清除复核并限制历史记录大小',()=>{
 let p=C.createProject();p.reviews=[true,true,true];p=C.commit(p,'修改任务','测试');assert.deepEqual(p.reviews,[false,false,false]);assert.equal(p.revision,2);
 for(let i=0;i<35;i++)p=C.commit(p,'修改任务');assert.equal(p.history.length,30);
});
test('导入拒绝重复道路、悬空引用、非法时窗、数值与背景',()=>{
 for(const mutate of [p=>p.edges.push({...p.edges[0],id:'X'}),p=>p.tasks[0].end='missing',p=>p.nodes[0].x=Infinity,p=>p.tasks[0].trips=1.5,p=>p.tasks[0].windowEnd='07:00',p=>p.tasks[0].windowStart='99:00',p=>p.background='javascript:alert(1)',p=>p.restrictions[0].edgeIds=['bad'],p=>p.tasks[0].trips='',p=>p.nodes[0].id='__proto__<']){
   const p=C.createProject();mutate(p);assert.throws(()=>C.validate(p));
 }
});
test('节点特殊名称不影响算法的 Map 键存取',()=>{
 const p=C.createProject();p.nodes.push({id:'__proto__',label:'边界节点',x:20,y:20});p.edges.push({id:'NEW',from:'A',to:'__proto__',length:3,width:4,closed:false});assert.equal(C.search(C.validate(p),'A','__proto__').distance,3);
});
test('CSV 转义引号换行并防止公式执行',()=>{
 const s=C.csv([['名称','备注'],['=1+1','含"引号,逗号\n换行'],['  @SUM(1)','普通']]);assert.ok(s.startsWith('\ufeff'));assert.ok(s.includes('"\'=1+1"'));assert.ok(s.includes('含""引号,逗号\n换行'));assert.ok(s.includes("'  @SUM"));
});
