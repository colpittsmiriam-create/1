/* Account-scoped cloud storage with serialized writes and optimistic concurrency. */
(function(){
 'use strict';
 const core=window.JiancaiCore,guestKey='jiancai-public-guest-v3';
 let user=null,ready=false,online=true,current=null,base='',desired=null,inflight=null,timer=null,blocked=false,projects=[],hooks=null,requestError='',status='正在连接服务…',generation=0;
 const cacheKey=()=>user?'jiancai-cloud-draft-v3:'+user.id+':'+(current?.id||'new'):guestKey;
 const setStatus=(text,error=false)=>{status=text;requestError=error?text:'';const el=document.querySelector('#saveStatus');if(el){el.textContent=text;el.classList.toggle('failed',error);}};
 async function api(path,options={}){
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
  try{
   const response=await fetch('/api/'+path,{...options,signal:controller.signal,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(!['GET','HEAD'].includes(options.method||'GET')?{'Idempotency-Key':crypto.randomUUID()}:{}),...options.headers},credentials:'same-origin'});
   const data=await response.json().catch(()=>({error:'服务响应格式不正确'}));
   if(!response.ok){const e=Error(data.error||'云端请求失败');e.code=data.code;e.status=response.status;e.details=data.details;e.requestId=data.requestId;throw e;}online=true;return data;
  }catch(e){if(e.name==='AbortError')throw Error('连接超时，请检查网络后重试');throw e;}finally{clearTimeout(timeout);}
 }
 function cache(project,dirty=false){try{localStorage.setItem(cacheKey(),JSON.stringify({project,cloudVersion:current?.version||null,dirty,at:new Date().toISOString()}));return true;}catch{return false;}}
 function cached(key){try{const value=JSON.parse(localStorage.getItem(key)||'null');return value&&{...value,project:core.validate(value.project)};}catch{return null;}}
 function install(data){generation++;current={id:data.id,version:data.version,role:data.role||'owner',workflowStatus:data.workflowStatus||'draft'};base=JSON.stringify(data.project);desired=null;blocked=false;cache(data.project);hooks.accept(data.project);setStatus('已保存到云端');}
 async function refreshList(){projects=await list(false);return projects;}
 async function open(id){
  await flush();const data=await api('projects/'+id);install(data);try{localStorage.setItem('jiancai-last-project:'+user.id,id);}catch{}return data;
 }
 async function create(project){
  if(!user){hooks.accept(project);persist(project);return;}
  await flush();const checked=core.validate(project);const created=await api('projects',{method:'POST',body:JSON.stringify({project:checked})});
  install({...created,project:{...checked,...created.modelMeta}});await refreshList();try{localStorage.setItem('jiancai-last-project:'+user.id,created.id);}catch{}
 }
 function persist(project){
  if(!ready)return;const serialized=JSON.stringify(project);const stored=cache(project,!!user&&serialized!==base);
  if(user&&blocked){desired=serialized;setStatus('云端版本冲突 · 本机修改已保留',true);return;}
  if(user&&current?.role==='viewer'){desired=null;setStatus('只读协作项目 · 修改需编辑权限');return;}
  if(!user){setStatus(stored?'访客体验 · 已保存到本机':'浏览器无法保存，请下载备份',!stored);return;}
  if(serialized===base&&!inflight){desired=null;setStatus('已保存到云端');return;}
  desired=serialized;
  if(blocked){setStatus('云端版本冲突 · 本机修改已保留',true);return;}
  if(!online){setStatus(stored?'当前离线 · 修改待同步':'离线且无法本地保存，请立即下载备份',true);return;}
  setStatus('正在保存…');clearTimeout(timer);timer=setTimeout(()=>flush().catch(()=>{}),700);
 }
 async function flush(){
  clearTimeout(timer);if(!user||!ready)return;
  if(blocked)throw Error('项目版本存在冲突。请先下载备份，再重新载入云端或将本机修改另存为新项目。');
  if(inflight){await inflight;if(desired&&desired!==base)return flush();return;}
  if(!desired||desired===base){desired=null;setStatus('已保存到云端');return;}
  if(!current)throw Error('请先选择一个云端项目');
  const sent=desired,expected=current.version,id=current.id,epoch=generation;desired=null;
  inflight=(async()=>{
   try{
    const result=await api('projects/'+id,{method:'PUT',headers:{'If-Match':'"'+expected+'"'},body:JSON.stringify({project:JSON.parse(sent)})});
    if(epoch!==generation)return;
    current.version=result.version;current.workflowStatus=result.workflowStatus||current.workflowStatus;const canonical={...JSON.parse(sent),...(result.modelMeta||{})};base=JSON.stringify(canonical);if(desired===sent)desired=null;cache(desired?JSON.parse(desired):canonical,!!desired);if(!desired&&base!==sent){hooks.accept(canonical);if(desired===base)desired=null;}
    if(!desired)setStatus('已保存到云端');
   }catch(e){
    if(epoch!==generation)return;if(!desired)desired=sent;
    if(e.code==='VERSION_CONFLICT'||e.code==='NOT_FOUND'){blocked=true;setStatus('云端版本已变化 · 点击账号处理',true);}
    else setStatus(e.message+' · 可点击账号重试',true);
    throw e;
   }finally{inflight=null;}
  })();
  await inflight;if(desired&&desired!==base)return flush();
 }
 async function init(callbacks){
  hooks=callbacks;
  try{
   const session=await api('session');user=session.user;
   if(user&&!session.storageReady)throw Error('服务端存储尚未就绪，请稍后刷新');
   if(!user){ready=true;const draft=cached(guestKey);hooks.accept(draft?.project||core.createProject());setStatus('访客体验 · 已保存到本机');return;}
   await refreshList();
   if(!projects.length){const created=await api('projects',{method:'POST',body:JSON.stringify({project:core.createProject()})});projects=[created];}
   let last=null;try{last=localStorage.getItem('jiancai-last-project:'+user.id);}catch{}
   const chosen=projects.find(p=>p.id===last)||projects[0];const saved=await api('projects/'+chosen.id);current={id:saved.id,version:saved.version,role:saved.role||'owner',workflowStatus:saved.workflowStatus||'draft'};
   const draft=cached(cacheKey());ready=true;
   if(saved.role!=='viewer'&&draft?.dirty&&JSON.stringify(draft.project)!==JSON.stringify(saved.project)){
    base=JSON.stringify(saved.project);
    if(draft.cloudVersion===saved.version){hooks.accept(draft.project);persist(draft.project);}
    else {blocked=true;desired=JSON.stringify(draft.project);hooks.accept(draft.project);setStatus('发现本机未同步修改 · 点击账号处理',true);}
   }else install(saved);
  }catch(e){
   ready=true;online=false;const draft=cached(cacheKey());if(draft)hooks.accept(draft.project);
   setStatus(e.message+' · 暂用本机草稿',true);
  }finally{updateChrome();}
 }
 function updateChrome(){
  const button=document.querySelector('#account');if(button){button.textContent=user?'我的云端项目':'登录保存';button.title=user?user.name:'登录后跨设备保存项目';}
  const bottom=document.querySelector('.side-bottom .demo');if(bottom)bottom.textContent=user?'账号专属云端项目':'访客体验 / 可直接试用';
  const foot=document.querySelector('footer>span');if(foot)foot.textContent=user?'云端项目 · 本机保留未同步草稿':'访客体验 · 登录后可跨设备保存';
  const readonly=current?.role==='viewer';
  document.querySelectorAll('#main form input,#main form select,#main form button[type=submit],#main [data-review]').forEach(el=>{el.disabled=readonly;});
  const editing=['add-task','edit-task','add-node','edit-node','add-road','edit-road','add-yard','edit-yard','add-restriction','edit-restriction','add-mark','toggle-road','select-yard','remove-background'];
  document.querySelectorAll('#main [data-action]').forEach(el=>{if(editing.includes(el.dataset.action)||el.dataset.action.startsWith('delete-')){el.disabled=readonly;if(readonly)el.title='此项目为只读，请联系所有者授予编辑权限';}});
  const stateEl=document.querySelector('#workflowState');if(stateEl)stateEl.textContent=({draft:'草稿方案',in_review:'等待复核',approved:'方案已确认'})[current?.workflowStatus]||'访客体验';
  const statusEl=document.querySelector('#saveStatus');if(statusEl){statusEl.textContent=status;statusEl.classList.toggle('failed',!!requestError);}
 }
 async function list(archived=false){if(!user)return [];const result=new Map();let offset=0;do{const data=await api('projects?limit=30&offset='+offset+(archived?'&archived=1':''));for(const item of data.projects)result.set(item.id,item);offset=data.pagination?.nextOffset??null;}while(offset!==null&&offset<1000);return [...result.values()];}
 async function archive(id,version){await flush();await api('projects/'+id,{method:'DELETE',headers:{'If-Match':'"'+(id===current?.id?current.version:version)+'"'}});await refreshList();if(id===current?.id){generation++;current=null;desired=null;base='';if(projects.length)await open(projects[0].id);else await create(core.createProject());}}
 async function restore(id,version){await api('projects/'+id+'/restore',{method:'POST',headers:{'If-Match':'"'+version+'"'}});await refreshList();await open(id);}
 async function remove(id,version){await api('projects/'+id+'/permanent',{method:'DELETE',headers:{'If-Match':'"'+version+'"'}});}
 async function reload(){
  // The caller explicitly chose to discard local edits after exporting a backup.
  if(inflight)await inflight.catch(()=>{});const id=current?.id;if(!id)throw Error('请先刷新页面重新连接');
  clearTimeout(timer);desired=null;blocked=false;const data=await api('projects/'+id);install(data);
 }
 async function fork(project){
  if(inflight)await inflight.catch(()=>{});const checked=core.validate(project);
  const data=await api('projects',{method:'POST',body:JSON.stringify({project:checked})});install({...data,project:{...checked,...data.modelMeta}});await refreshList();
 }
 async function requestProject(path,method='GET',body){
  if(!user||!current)throw Error('请先登录并选择云端项目');
  if(method!=='GET')await flush();
  return api('projects/'+current.id+(path?'/'+path:''),{method,...(body?{body:JSON.stringify(body)}:{}),...(method!=='GET'?{headers:{'If-Match':'"'+current.version+'"'}}:{})});
 }
 function preserveConflict(error,draft){
  if(error.code==='VERSION_CONFLICT'||error.code==='FORBIDDEN'){
   blocked=true;const project=draft||window.Jiancai.getState();desired=JSON.stringify(project);cache(project,true);hooks.accept(project);setStatus('云端版本或权限已变化 · 点击账号处理',true);
  }else if(draft&&(!error.status||error.status===503||error.status===429)){
   online=false;desired=JSON.stringify(draft);cache(draft,true);hooks.accept(draft);setStatus(navigator.onLine?error.message+' · 本机草稿待同步':'当前离线 · 修改待同步',true);
  }
 }
 async function mutateEntity(collection,method,id,body){
  if(current?.role==='viewer')throw Error('当前项目只有查看权限');
  let draft=core.clone(window.Jiancai.getState());
  try{
   const key={roads:'edges',nodes:'nodes',tasks:'tasks',yards:'yards',restrictions:'restrictions',annotations:'annotations'}[collection],items=draft[key],index=items.findIndex(item=>item.id===id);
   if(method==='PATCH')items[index]={...items[index],...body};else if(method==='DELETE')items.splice(index,1);
   else {let n=1;const prefix={roads:'R',nodes:'N',tasks:'T',yards:'S',restrictions:'X',annotations:'M'}[collection];while(items.some(item=>item.id===prefix+String(n).padStart(2,'0')))n++;items.push({...body,id:body.id||prefix+String(n).padStart(2,'0')});}
   draft=core.commit(draft,'保留未同步的业务修改');
  }catch{draft=null;}
  try{await requestProject(collection+(id?'/'+encodeURIComponent(id):''),method,body);const loaded=await api('projects/'+current.id);install(loaded);return loaded;}
  catch(error){preserveConflict(error,draft);throw error;}
 }
 async function settings(body){
  let draft;try{draft=core.commit({...window.Jiancai.getState(),...body},'保留未同步的项目信息');}catch{draft=null;}
  try{await requestProject('settings','PATCH',body);install(await api('projects/'+current.id));}catch(error){preserveConflict(error,draft);throw error;}
 }
 async function plan(){return requestProject('planning-runs','POST',{taskId:window.Jiancai.getState().activeTaskId});}
 async function transition(action){await requestProject(action,'POST',{});install(await api('projects/'+current.id));}
 async function history(){return requestProject('versions?limit=30');}
 async function audit(){return requestProject('audit-events?limit=30');}
 async function runs(){return requestProject('planning-runs?limit=30');}
 async function getRun(id){return requestProject('planning-runs/'+encodeURIComponent(id));}
 async function restoreVersion(value){await requestProject('versions/'+value+'/restore','POST',{});install(await api('projects/'+current.id));}
 async function members(){return requestProject('members');}
 async function addMember(email,role){return requestProject('members','POST',{email,role});}
 async function removeMember(id){return requestProject('members/'+encodeURIComponent(id),'DELETE');}
 function editable(){return !!user&&!!current&&current.role!=='viewer';}
 window.addEventListener('offline',()=>{online=false;setStatus('当前离线 · 修改待同步',true);});
 window.addEventListener('online',()=>{online=true;if(!blocked)flush().catch(()=>{});});
 window.addEventListener('beforeunload',e=>{if(user&&(desired||inflight)){e.preventDefault();e.returnValue='';}});
 window.Cloud={getRun,mutateEntity,settings,plan,transition,history,audit,runs,restoreVersion,members,addMember,removeMember,editable,init,persist,updateChrome,flush,open,create,list,archive,restore,remove,reload,fork,guestDraft:()=>cached(guestKey)?.project,
  retry:()=>current?flush():init(hooks),info:()=>({user,current,blocked,ready,error:requestError,pending:!!desired||!!inflight,projects}),signIn:()=>'/signin-with-chatgpt?return_to=%2F',signOut:()=>'/signout-with-chatgpt?return_to=%2F'};
})();
