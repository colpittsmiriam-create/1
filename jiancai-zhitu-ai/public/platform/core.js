/* Pure domain functions shared by the browser and Node regression tests. */
(function (root) {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const materials = ['砌块', '钢筋', '模板', '砂石', '其他'];
  const phases = ['基础施工', '主体施工', '砌筑阶段', '装修阶段', '市政施工'];
  const date = () => new Date().toISOString();
  function createProject() {
    const positions = { A:[10,70], B:[10,40], C:[10,10], D:[45,10], E:[80,10], F:[110,10], G:[110,40], H:[45,40], I:[80,70], J:[45,70], K:[110,70], L:[80,40] };
    const roads = [['A','B',30],['B','C',35],['C','D',35],['D','E',35],['E','F',30],['F','G',30],['G','K',30],['K','I',30],['I','J',35],['J','A',40],['D','H',30],['H','J',30],['E','L',25],['L','I',25],['G','L',30],['B','H',40]];
    return {
      schemaVersion:2,id:'demo-jiancai',name:'邯郸房建示范场地',phase:'主体施工',siteWidth:120,siteHeight:80,
      source:'模拟场地',background:null,revision:1,updatedAt:date(),activeTaskId:'T01',selectedYard:'S2',requiredArea:60,
      nodes:Object.entries(positions).map(([id,[x,y]])=>({id,x,y,label:({A:'材料入口',L:'主体作业面',J:'南侧堆场',G:'东侧堆场'})[id]||'道路节点'})),
      edges:roads.map(([from,to,length],i)=>({id:'R'+String(i+1).padStart(2,'0'),from,to,length,width:4.5,closed:false})),
      annotations:[],
      tasks:[
        {id:'T01',name:'砌块配送',material:'砌块',start:'A',end:'L',trips:10,width:2.2,speed:1.2,handling:4,hourlyRate:120,baseline:220,windowStart:'08:00',windowEnd:'09:30',resource:'小型转运车 01'},
        {id:'T02',name:'钢筋补料',material:'钢筋',start:'C',end:'L',trips:5,width:3,speed:1,handling:6,hourlyRate:150,baseline:200,windowStart:'10:00',windowEnd:'11:30',resource:'平板运输车 01'},
        {id:'T03',name:'模板周转',material:'模板',start:'G',end:'H',trips:6,width:2.8,speed:1,handling:5,hourlyRate:120,baseline:240,windowStart:'13:00',windowEnd:'14:30',resource:'小型转运车 01'}
      ],
      yards:[{id:'S1',name:'现有入口堆场',node:'A',area:180,relocation:0,approved:true},{id:'S2',name:'南侧近端堆场',node:'J',area:100,relocation:60,approved:true},{id:'S3',name:'东侧备用堆场',node:'G',area:45,relocation:100,approved:false}],
      restrictions:[{id:'X01',name:'交叉作业占道',start:'09:30',end:'10:00',edgeIds:['R09']}],
      reviews:[false,false,false],history:[{revision:1,at:date(),action:'载入示范场地',summary:'12 个节点 / 16 条道路 / 3 项任务'}]
    };
  }
  function number(value,min,max,label,integer=false) {
    if(value===''||value===null||typeof value==='boolean') throw Error(label+'不能为空');
    const n=Number(value);
    if(!Number.isFinite(n)||n<min||n>max||(integer&&!Number.isInteger(n))) throw Error(label+`应为 ${min} 至 ${max} 的${integer?'整数':'数值'}`);
    return n;
  }
  function str(value,label,max=80) {
    if(typeof value!=='string'||!value.trim()||value.length>max) throw Error(label+`不能为空且不超过 ${max} 字`);
    return value.trim();
  }
  function time(value) {
    if(typeof value!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw Error('时间须为 HH:MM 格式');
    return Number(value.slice(0,2))*60+Number(value.slice(3));
  }
  function list(value,label,max) {
    if(!Array.isArray(value)||value.length>max) throw Error(label+`须为数组且不超过 ${max} 项`);
    return value;
  }
  function unique(items,label) { if(new Set(items.map(x=>x.id)).size!==items.length) throw Error(label+'编号重复'); }
  function validate(raw) {
    if(!raw||raw.schemaVersion!==2) throw Error('请导入本平台 2.0 导出的项目备份');
    const p={schemaVersion:2,id:str(raw.id,'项目编号'),name:str(raw.name,'项目名称',60),phase:str(raw.phase,'施工阶段',30),source:str(raw.source,'资料来源',120),siteWidth:number(raw.siteWidth,10,10000,'场地宽度'),siteHeight:number(raw.siteHeight,10,10000,'场地高度'),revision:number(raw.revision,1,1e9,'版本号',true),updatedAt:typeof raw.updatedAt==='string'&&!isNaN(Date.parse(raw.updatedAt))?raw.updatedAt:date(),background:null};
    if(raw.background) {
      if(typeof raw.background!=='string'||raw.background.length>3000000||!/^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(raw.background)) throw Error('底图须为不超过 2 MB 的 PNG、JPEG 或 WebP 图片');
      p.background=raw.background;
    }
    p.nodes=list(raw.nodes,'节点',200).map(n=>({id:str(n.id,'节点编号',12),label:str(n.label,'节点名称',40),x:number(n.x,0,p.siteWidth,'节点 X 坐标'),y:number(n.y,0,p.siteHeight,'节点 Y 坐标')}));
    if(p.nodes.length<2) throw Error('场地至少需要两个节点');
    if(p.nodes.some(n=>! /^[A-Za-z0-9_-]+$/.test(n.id))) throw Error('节点编号只支持字母、数字、横线和下划线');
    unique(p.nodes,'节点'); const ids=new Set(p.nodes.map(n=>n.id));
    p.edges=list(raw.edges,'道路',1000).map(e=>{
      if(!ids.has(e.from)||!ids.has(e.to)||e.from===e.to) throw Error('道路端点无效');
      return {id:str(e.id,'道路编号',20),from:e.from,to:e.to,length:number(e.length,0.1,100000,'道路长度'),width:number(e.width,0.1,50,'道路净宽'),closed:e.closed===true};
    }); unique(p.edges,'道路');
    if(new Set(p.edges.map(e=>[e.from,e.to].sort().join('|'))).size!==p.edges.length) throw Error('同一对节点不能重复录入道路');
    p.tasks=list(raw.tasks,'搬运任务',200).map(t=>{
      if(!ids.has(t.start)||!ids.has(t.end)) throw Error('任务起终点不在场地内');
      if(time(t.windowStart)>=time(t.windowEnd)) throw Error('任务结束时间必须晚于开始时间');
      if(!materials.includes(t.material)) throw Error('材料类别无效');
      return {id:str(t.id,'任务编号',20),name:str(t.name,'任务名称',40),material:t.material,start:t.start,end:t.end,trips:number(t.trips,1,100000,'车次',true),width:number(t.width,0.1,50,'通行净宽要求'),speed:number(t.speed,0.1,10,'行驶速度'),handling:number(t.handling,0,240,'单车装卸时间'),hourlyRate:number(t.hourlyRate,0,100000,'设备小时成本'),baseline:number(t.baseline,0,100000,'人工基线距离'),windowStart:t.windowStart,windowEnd:t.windowEnd,resource:str(t.resource,'设备名称',40)};
    }); unique(p.tasks,'任务');
    p.yards=list(raw.yards,'堆场',100).map(y=>{
      if(!ids.has(y.node)) throw Error('堆场节点无效');
      return {id:str(y.id,'堆场编号',20),name:str(y.name,'堆场名称',40),node:y.node,area:number(y.area,0,100000,'可用面积'),relocation:number(y.relocation,0,10000000,'调整投入'),approved:y.approved===true};
    }); unique(p.yards,'堆场');
    const edgeIds=new Set(p.edges.map(e=>e.id));
    p.restrictions=list(raw.restrictions||[],'通道时窗',100).map(r=>{
      if(time(r.start)>=time(r.end)) throw Error('占道结束时间必须晚于开始时间');
      const edgeList=list(r.edgeIds,'占用道路',1000);
      if(!edgeList.length||edgeList.some(id=>!edgeIds.has(id))) throw Error('占道记录需关联有效道路');
      return {id:str(r.id,'占道编号',20),name:str(r.name,'占道名称',40),start:r.start,end:r.end,edgeIds:[...new Set(edgeList)]};
    }); unique(p.restrictions,'占道');
    p.annotations=list(raw.annotations||[],'标注',100).map(a=>({id:str(a.id,'标注编号',30),label:str(a.label,'标注内容',50),x:number(a.x,0,p.siteWidth,'标注 X'),y:number(a.y,0,p.siteHeight,'标注 Y')})); unique(p.annotations,'标注');
    p.activeTaskId=p.tasks.some(t=>t.id===raw.activeTaskId)?raw.activeTaskId:(p.tasks[0]?.id||null);
    p.selectedYard=p.yards.some(y=>y.id===raw.selectedYard)?raw.selectedYard:(p.yards[0]?.id||null);
    p.requiredArea=number(raw.requiredArea??60,1,100000,'需求面积');
    p.reviews=[0,1,2].map(i=>raw.reviews?.[i]===true);
    p.history=list(raw.history||[],'版本记录',100).slice(-30).map(h=>({revision:number(h.revision,1,1e9,'历史版本',true),at:typeof h.at==='string'&&!isNaN(Date.parse(h.at))?h.at:date(),action:str(h.action,'历史操作',80),summary:typeof h.summary==='string'?h.summary.slice(0,300):''}));
    return p;
  }
  function search(p,start,end,minWidth=0,blocked=[]) {
    const ids=p.nodes.map(n=>n.id),usable=p.edges.filter(e=>!e.closed&&e.width>=minWidth&&!blocked.includes(e.id));
    if(!ids.includes(start)||!ids.includes(end)) return {path:[],edgeIds:[],distance:null,available:usable.length};
    const distances=new Map(ids.map(id=>[id,Infinity])),previous=new Map(),open=new Set([start]); distances.set(start,0);
    while(open.size) {
      const u=[...open].reduce((a,b)=>distances.get(a)<=distances.get(b)?a:b); open.delete(u);
      if(u===end) {
        const path=[end],edgePath=[]; let c=end;
        while(c!==start) {const prev=previous.get(c); if(!prev) return {path:[],edgeIds:[],distance:null,available:usable.length}; edgePath.unshift(prev.edge);c=prev.node;path.unshift(c);}
        return {path,edgeIds:edgePath,distance:Math.round(distances.get(end)*100)/100,available:usable.length};
      }
      for(const e of usable) {
        const v=e.from===u?e.to:e.to===u?e.from:null; if(v===null) continue;
        const next=distances.get(u)+e.length;
        if(next<distances.get(v)) {distances.set(v,next);previous.set(v,{node:u,edge:e.id});open.add(v);}
      }
    }
    return {path:[],edgeIds:[],distance:null,available:usable.length};
  }
  const overlap=(a,b,c,d)=>a<d&&c<b;
  function route(p,t) {
    if(!t) return {path:[],edgeIds:[],distance:null,available:0,blocked:[]};
    const blocked=[...new Set(p.restrictions.filter(r=>overlap(time(t.windowStart),time(t.windowEnd),time(r.start),time(r.end))).flatMap(r=>r.edgeIds))];
    return {...search(p,t.start,t.end,t.width,blocked),blocked};
  }
  function estimate(t,distance) {
    if(distance===null) return {minutes:null,cost:null,totalDistance:null};
    const minutes=t.trips*(2*distance/t.speed/60+t.handling);
    return {minutes:Math.round(minutes*10)/10,cost:Math.round(minutes/60*t.hourlyRate*100)/100,totalDistance:Math.round(distance*t.trips*100)/100};
  }
  function issues(p) {
    const out=[];
    for(const t of p.tasks) {
      const r=route(p,t),est=estimate(t,r.distance);
      if(r.distance===null) out.push({type:'error',taskIds:[t.id],title:t.name+'无可行路线',detail:'请核对道路连通性、净宽及作业时窗。'});
      else if(est.minutes>time(t.windowEnd)-time(t.windowStart)) out.push({type:'warn',taskIds:[t.id],title:t.name+'超出配送时窗',detail:`估算需 ${est.minutes} 分钟，当前时窗 ${time(t.windowEnd)-time(t.windowStart)} 分钟。`});
    }
    for(let i=0;i<p.tasks.length;i++) for(let j=i+1;j<p.tasks.length;j++) {
      const a=p.tasks[i],b=p.tasks[j];
      if(a.resource===b.resource&&overlap(time(a.windowStart),time(a.windowEnd),time(b.windowStart),time(b.windowEnd))) out.push({type:'error',taskIds:[a.id,b.id],title:'设备时窗冲突',detail:`${a.name}与${b.name}同时占用「${a.resource}」。`});
    }
    return out;
  }
  function compareYards(p,t) {
    if(!t) return [];
    const blocked=route(p,t).blocked;
    return p.yards.map(y=>{
      const r=search(p,y.node,t.end,t.width,blocked),est=estimate(t,r.distance),reasons=[];
      if(!y.approved) reasons.push('占地未确认');if(y.area<p.requiredArea) reasons.push('可用面积不足');if(r.distance===null) reasons.push('道路不可达');
      return {...y,route:r,...est,eligible:reasons.length===0,reasons,totalCost:est.cost===null?null:Math.round((est.cost+y.relocation)*100)/100};
    }).sort((a,b)=>Number(b.eligible)-Number(a.eligible)||(a.totalCost??Infinity)-(b.totalCost??Infinity));
  }
  function commit(p,action,summary='') {
    const checked=validate(p);checked.revision++;checked.updatedAt=date();checked.reviews=[false,false,false];
    checked.history.push({revision:checked.revision,at:checked.updatedAt,action,summary});checked.history=checked.history.slice(-30);return checked;
  }
  function csv(rows) {
    return '\ufeff'+rows.map(row=>row.map(value=>{
      let s=String(value??'');if(/^[\s]*[=+\-@\t\r]/.test(s)) s="'"+s;
      return '"'+s.replace(/"/g,'""')+'"';
    }).join(',')).join('\r\n');
  }
  function backup(p) {return {format:'jiancai-project-backup',exportedAt:date(),project:clone(p),calculation:{method:'Dijkstra / A* with zero heuristic',fieldVerified:false,tasks:p.tasks.map(t=>({taskId:t.id,...route(p,t),estimate:estimate(t,route(p,t).distance)})),issues:issues(p)}};}
  const api={createProject,validate,search,route,estimate,issues,compareYards,commit,csv,backup,clone,time,number,str,materials,phases,overlap};
  if(typeof module!=='undefined'&&module.exports) module.exports=api;else root.JiancaiCore=api;
})(typeof window!=='undefined'?window:globalThis);
