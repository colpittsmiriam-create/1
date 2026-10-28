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
   const response=await fetch('/api/'+path,{...options,signal:controller.signal,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...options.headers},credentials:'same-origin'});
   const data=await response.json().catch(()=>({error:'服务响应格式不正确'}));
   if(!response.ok){const e=Error(data.error||'云端请求失败');e.code=data.code;e.status=response.status;throw e;}online=true;return data;
  }catch(e){if(e.name==='AbortError')throw Error('连接超时，请检查网络后重试');throw e;}finally{clearTimeout(timeout);}
 }
 function cache(project,dirty=false){try{localStorage.setItem(cacheKey(),JSON.stringify({project,cloudVersion:current?.version||null,dirty,at:new Date().toISOString()}));return true;}catch{return false;}}
 function cached(key){try{const value=JSON.parse(localStorage.getItem(key)||'null');return value&&{...value,project:core.validate(value.project)};}catch{return null;}}
 function install(data){generation++;current={id:data.id,version:data.version};base=JSON.stringify(data.project);desired=null;blocked=false;cache(data.project);hooks.accept(data.project);setStatus('已保存到云端');}
 async function refreshList(){const data=await api('projects');projects=data.projects;return projects;}
 async function open(id){
  await flush();const data=await api('projects/'+id);install(data);try{localStorage.setItem('jiancai-last-project:'+user.id,id);}catch{}return data;
 }
 async function create(project){
  if(!user){hooks.accept(project);persist(project);return;}
  await flush();const checked=core.validate(project);const created=await api('projects',{method:'POST',body:JSON.stringify({project:checked})});
  install({...created,project:checked});await refreshList();try{localStorage.setItem('jiancai-last-project:'+user.id,created.id);}catch{}
 }
 function persist(project){
  if(!ready)return;const serialized=JSON.stringify(project);const stored=cache(project,!!user&&serialized!==base);
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
    current.version=result.version;base=sent;if(desired===sent)desired=null;cache(desired?JSON.parse(desired):JSON.parse(sent),!!desired);
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
   const chosen=projects.find(p=>p.id===last)||projects[0];const saved=await api('projects/'+chosen.id);current={id:saved.id,version:saved.version};
   const draft=cached(cacheKey());ready=true;
   if(draft?.dirty&&JSON.stringify(draft.project)!==JSON.stringify(saved.project)){
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
  const statusEl=document.querySelector('#saveStatus');if(statusEl){statusEl.textContent=status;statusEl.classList.toggle('failed',!!requestError);}
 }
 async function list(archived=false){if(!user)return [];const data=await api('projects'+(archived?'?archived=1':''));return data.projects;}
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
  const data=await api('projects',{method:'POST',body:JSON.stringify({project:checked})});install({...data,project:checked});await refreshList();
 }
 window.addEventListener('offline',()=>{online=false;setStatus('当前离线 · 修改待同步',true);});
 window.addEventListener('online',()=>{online=true;if(!blocked)flush().catch(()=>{});});
 window.addEventListener('beforeunload',e=>{if(user&&(desired||inflight)){e.preventDefault();e.returnValue='';}});
 window.Cloud={init,persist,updateChrome,flush,open,create,list,archive,restore,remove,reload,fork,guestDraft:()=>cached(guestKey)?.project,
  retry:()=>current?flush():init(hooks),info:()=>({user,current,blocked,ready,error:requestError,pending:!!desired||!!inflight,projects}),signIn:()=>'/signin-with-chatgpt?return_to=%2F',signOut:()=>'/signout-with-chatgpt?return_to=%2F'};
})();
