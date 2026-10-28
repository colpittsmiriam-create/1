'use strict';
(function(){
 let latest=null;
 const statuses={draft:'草稿方案',in_review:'等待复核',approved:'方案已确认'},roles={owner:'所有者',editor:'可编辑',viewer:'只读协作'};
 const button=(action,label,id='',disabled=false)=>`<button type="button" class="btn small" data-backend="${action}" ${id?`data-id="${esc(id)}"`:''} ${disabled?'disabled':''}>${label}</button>`;
 function decorate(){
  const info=Cloud.info();if(!info.user||!info.current)return;
  const existing=$('#businessBar');if(existing)existing.remove();
  const current=info.current,owner=current.role==='owner',editable=current.role!=='viewer';
  const bar=`<div class="business-bar" id="businessBar"><div><span class="badge" id="workflowState">${statuses[current.workflowStatus]||'草稿方案'}</span><span>${roles[current.role]||'成员'} · 记录版本 ${current.version}</span>${latest&&latest.projectId===current.id?`<span class="${latest.inputVersion===current.version?'verified-note':'muted'}">${latest.inputVersion===current.version?'✓ 已校验当前版本':'模型已变化，需重新校验'}</span>`:''}</div><div>${button('calculate','计算并校验','',!editable)}${button('runs','方案记录')}${button('history','历史版本')}${button('members','项目成员')}${['report','schedule'].includes(page)&&owner?button('submit','提交复核','',current.workflowStatus!=='draft')+button('approve','确认方案','',current.workflowStatus!=='in_review'):''}</div></div>`;
  $('.page-head')?.insertAdjacentHTML('afterend',bar);
 }
 function displayRun(run){
  latest={...run,projectId:run.projectId||run.project_id,inputVersion:run.inputVersion||run.input_version};const data=run.result;
  modal('场内物流方案校验',`<div class="run-heading"><span class="badge ${run.status==='success'?'':'warn'}">${run.status==='success'?'规则检查通过':run.status==='no_solution'?'当前无可行路线':'有待处理事项'}</span><span>输入版本 ${run.inputVersion||run.input_version}${run.stale?' · 已过期':''}</span></div><div class="run-distance">${fmt(data.result.distance)} <small>m / 单程</small></div><div class="route-seq">${data.result.path.map(n=>`<span class="node-pill">${esc(n)}</span>`).join('<span>→</span>')||badge('无可行路线','warn')}</div><div class="row"><span>估算完整工时</span><b>${fmt(data.estimate.minutes)} 分钟</b></div><div class="row"><span>估算搬运成本</span><b>¥ ${fmt(data.estimate.cost,2)}</b></div><div class="row"><span>校验任务</span><b>${data.tasks.length} 项</b></div><div class="run-issues">${data.issues.length?data.issues.map(i=>`<div class="notice"><b>${esc(i.title)}</b><br>${esc(i.detail)}</div>`).join(''):'<p class="help-copy">未发现已录入参数下的路线、工时及设备时窗问题。</p>'}</div><p class="help-copy">结果依据已保存的场地、道路、任务和时窗生成，已留存计算记录。工程条件仍需现场核对。</p><div class="form-actions">${btn('close','完成','primary')}</div>`);
  decorate();
 }
 async function calculate(){const info=Cloud.info();if(!info.user){toast('登录后可保存可追溯的方案校验记录');return;}displayRun(await Cloud.plan());}
 async function showRuns(){
  const data=await Cloud.runs();modal('方案计算记录',`<div class="backend-record-list">${data.items.map(item=>`<div class="record-line"><div><b>${esc(item.taskId)} · 输入版本 ${item.inputVersion} ${item.stale?badge('已过期','warn'):badge('当前版本')}</b><small>${stamp(item.createdAt)} · ${esc(item.status)}</small></div>${button('run','查看',item.id)}</div>`).join('')||empty('尚无方案记录','点击“计算并校验”，按已保存的项目生成方案。')}</div><div class="form-actions">${btn('close','关闭')}</div>`);
 }
 async function showHistory(){
  const [versions,audit]=await Promise.all([Cloud.history(),Cloud.audit()]),readonly=Cloud.info().current.role==='viewer';
  modal('历史版本与操作记录',`<h3>项目版本</h3><p class="help-copy">历史恢复会创建新的草稿版本，并清除原复核记录。</p><div class="backend-record-list">${versions.items.map(v=>`<div class="record-line"><div><b>记录版本 ${v.version} ${v.version===versions.currentVersion?badge('当前'):''}</b><small>${esc(v.action)} · ${stamp(v.createdAt)}</small></div>${v.version!==versions.currentVersion&&!readonly?button('restore-confirm','恢复',v.version):''}</div>`).join('')}</div><h3 class="backend-subhead">最近操作</h3><div class="backend-record-list">${audit.items.map(event=>`<div class="record-line"><div><b>${esc(event.action)}</b><small>${esc(event.actorId)} · ${stamp(event.createdAt)}</small></div></div>`).join('')}</div><div class="form-actions">${btn('close','关闭')}</div>`);
 }
 async function showMembers(){
  const result=await Cloud.members(),owner=result.role==='owner';
  modal('项目成员与权限',`<p class="help-copy">所有者可管理项目和成员；编辑者可维护业务数据；查看者可阅读与导出。受邀账号需先登录本站一次。</p><div class="backend-record-list">${result.members.map(member=>`<div class="record-line"><div><b>${esc(member.name||member.email)} ${badge(roles[member.role])}</b><small>${esc(member.email)}</small></div>${owner&&member.role!=='owner'?button('remove-member','移除',member.userId):''}</div>`).join('')}</div>${owner?`<form data-backend-form="member" class="member-form"><div class="field"><label for="memberEmail">成员邮箱</label><input id="memberEmail" name="email" type="email" required maxlength="254" placeholder="已登录过本站的账号邮箱"></div><div class="field"><label for="memberRole">授予权限</label><select id="memberRole" name="role"><option value="viewer">只读查看</option><option value="editor">编辑业务数据</option></select></div><button type="submit" class="btn primary">添加 / 更新成员</button><p class="form-error" role="alert" hidden></p></form>`:''}<div class="form-actions">${btn('close','关闭')}</div>`);
 }
 document.addEventListener('click',async event=>{
  const target=event.target.closest('[data-backend]');if(!target)return;const action=target.dataset.backend,id=target.dataset.id;
  target.disabled=true;
  try{
   if(action==='calculate')await calculate();
   if(action==='runs')await showRuns();
   if(action==='run')displayRun(await Cloud.getRun(id));
   if(action==='history')await showHistory();
   if(action==='members')await showMembers();
   if(action==='remove-member'){await Cloud.removeMember(id);await showMembers();toast('成员权限已移除');}
   if(action==='restore-confirm')modal('恢复历史版本',`<p>将记录版本 ${esc(id)} 恢复为一个新的草稿版本。当前版本仍会留在历史中。</p><div class="form-actions">${btn('close','取消')}${button('restore','确认恢复',id)}</div>`);
   if(action==='restore'){await Cloud.restoreVersion(id);$('#dialog').close();toast('已恢复为新的草稿版本');}
   if(action==='submit'||action==='approve'){await Cloud.transition(action);toast(action==='submit'?'方案已提交复核':'方案已确认');}
  }catch(e){
   if(e.details)modal('方案仍需调整',`<div class="run-issues">${e.details.map(i=>`<div class="notice"><b>${esc(i.title)}</b><br>${esc(i.detail)}</div>`).join('')}</div><div class="form-actions">${btn('close','返回调整')}</div>`);
   else toast(e.message);
  }finally{if(target.isConnected)target.disabled=false;}
 });
 document.addEventListener('submit',async event=>{
  if(event.target.dataset.backendForm!=='member')return;event.preventDefault();const form=event.target,values=Object.fromEntries(new FormData(form)),button=form.querySelector('button[type=submit]');button.disabled=true;
  try{await Cloud.addMember(values.email,values.role);await showMembers();toast('成员权限已保存');}catch(e){const message=form.querySelector('.form-error');message.hidden=false;message.textContent=e.message;}finally{if(button.isConnected)button.disabled=false;}
 });
 window.BackendUI={decorate,calculate};decorate();
})();
