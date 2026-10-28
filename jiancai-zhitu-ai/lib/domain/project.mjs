import Core from '../engine.mjs';
import {fail,bytes,now} from '../http/middleware.mjs';
export const collections={
 nodes:{key:'nodes',prefix:'N',fields:['id','label','x','y']},
 roads:{key:'edges',prefix:'R',fields:['id','from','to','length','width','closed']},
 tasks:{key:'tasks',prefix:'T',fields:['id','name','material','start','end','trips','width','speed','handling','hourlyRate','baseline','windowStart','windowEnd','resource']},
 yards:{key:'yards',prefix:'S',fields:['id','name','node','area','relocation','approved']},
 restrictions:{key:'restrictions',prefix:'X',fields:['id','name','start','end','edgeIds']},
 annotations:{key:'annotations',prefix:'M',fields:['id','label','x','y']}
};
export function validate(input){
 let p;try{p=Core.validate(input);}catch(e){fail(422,e.message,'INVALID_PROJECT');}
 if(p.restrictions.reduce((n,r)=>n+r.edgeIds.length,0)>2000)fail(422,'占道与道路关联总数不能超过 2000 条','INVALID_PROJECT');
 const withoutImage={...p,background:null};if(bytes(JSON.stringify(withoutImage))>900000)fail(413,'模型正文不能超过 900 KB','TOO_LARGE');return p;
}
export function businessSignature(p,assetHash){const {reviews,history,revision,updatedAt,activeTaskId,background,...business}=p;return JSON.stringify({...business,assetHash:assetHash||null});}
export function editEntity(model,collection,method,id,body){
 const definition=collections[collection];if(!definition)fail(404,'业务资源不存在','NOT_FOUND');
 if(Object.keys(body).some(key=>!definition.fields.includes(key)))fail(422,'包含不支持的业务字段','UNKNOWN_FIELDS');
 const p=Core.clone(model),items=p[definition.key],index=items.findIndex(item=>item.id===id);
 if(method!=='POST'&&index<0)fail(404,'业务记录不存在','NOT_FOUND');
 if(method==='POST'){
  let generated=1;while(items.some(item=>item.id===definition.prefix+String(generated).padStart(2,'0')))generated++;
  const item={...body,id:body.id||definition.prefix+String(generated).padStart(2,'0')};items.push(item);if(collection==='tasks')p.activeTaskId=item.id;
 }else if(method==='PATCH'){if(body.id&&body.id!==id)fail(422,'不能修改记录编号','IMMUTABLE_ID');items[index]={...items[index],...body,id};}
 else if(method==='DELETE')items.splice(index,1);else fail(405,'不支持此操作','METHOD_NOT_ALLOWED');
 try{return Core.commit(p,`${method==='POST'?'新增':method==='DELETE'?'删除':'修改'}${collection}`,id||body.name||body.label||'业务记录');}catch(e){fail(422,e.message+'；删除节点或道路前请先处理关联记录','INVALID_PROJECT');}
}
export function readyForReview(model){
 const problems=Core.issues(model);if(!model.tasks.length)problems.push({type:'error',title:'尚未录入搬运任务',detail:'请至少建立一项任务。',taskIds:[]});
 const chosen=Core.compareYards(model,model.tasks.find(t=>t.id===model.activeTaskId)).find(y=>y.id===model.selectedYard);
 if(chosen&&!chosen.eligible)problems.push({type:'error',title:'当前堆场仍有启用条件未确认',detail:chosen.reasons.join('、'),taskIds:[]});
 if(problems.length)fail(422,'方案仍有待处理事项，不能进入确认流程','PLAN_NOT_READY',problems);return true;
}
export function calculation(model,taskId){
 const selected=taskId||model.activeTaskId,task=model.tasks.find(t=>t.id===selected);
 if(!task)fail(422,'请先选择有效搬运任务','TASK_REQUIRED');
 const result=Core.route(model,task);
 return {algorithm:'Dijkstra / A* h=0',algorithmVersion:'1.0',taskId:task.id,result,estimate:Core.estimate(task,result.distance),yards:Core.compareYards(model,task),issues:Core.issues(model),tasks:model.tasks.map(t=>({taskId:t.id,...Core.route(model,t),estimate:Core.estimate(t,Core.route(model,t).distance)})),fieldVerified:false,computedAt:now()};
}
