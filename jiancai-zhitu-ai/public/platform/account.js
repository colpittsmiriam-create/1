'use strict';
async function showAccount(archived=false){
 const info=Cloud.info();
 if(!info.user){
  modal('把项目保存到云端',`<div class="account-intro"><span class="cloud-symbol">☁</span><h3>随时接着上一次的现场规划</h3><p>当前为访客体验，数据只保存在这台设备。登录后，每个账号拥有独立的项目、底图和版本记录，可跨设备访问。</p><a class="btn primary" href="${Cloud.signIn()}" target="_top">使用 ChatGPT 登录</a><p class="help-copy">由托管平台提供登录，本应用不收集或保存密码。访客体验内容可在登录后，从账号菜单手动导入。</p>${btn('close','继续体验','wide')} ${info.error?`<p class="form-error">${esc(info.error)}</p><button class="btn" data-cloud="retry">重新连接</button>`:''}</div>`);
  return;
 }
 let rows;try{rows=await Cloud.list(archived);}catch(e){rows=[];toast(e.message);}
 const latest=Cloud.info();
 modal('我的云端项目',`<div class="account-profile"><span class="account-avatar">${esc(info.user.name?.slice(0,1)||'我')}</span><div><b>${esc(info.user.name)}</b><small>账号专属空间 · 最多 30 个项目（含归档）</small></div><a class="text-link" href="${Cloud.signOut()}" target="_top" id="cloudSignOut">退出登录</a></div>${latest.error?`<div class="sync-warning"><h3>${latest.blocked?'保留本机修改，再处理版本冲突':'暂未完成云端保存'}</h3><p>${esc(latest.error)}</p><div class="account-buttons">${btn('backup','下载本机备份')}${latest.blocked?'<button class="btn primary" data-cloud="fork">另存为新云端项目</button><button class="btn" data-cloud="reload-confirm">备份并重新载入云端</button>':'<button class="btn primary" data-cloud="retry">立即重试</button>'}</div></div>`:''}<div class="account-tabs"><button class="${archived?'':'active'}" data-cloud="list">正在使用</button><button class="${archived?'active':''}" data-cloud="archives">已归档</button><span>${rows.length} 个项目</span></div><div class="cloud-project-list">${rows.map(p=>`<div class="cloud-project"><div><b>${esc(p.name)} ${p.id===info.current?.id?badge('当前项目'):''}</b><small>${esc(p.phase)} · ${stamp(p.updatedAt)}</small></div><div class="cloud-project-actions">${archived?`<button class="btn small" data-cloud="restore" data-id="${p.id}" data-version="${p.version}">恢复</button><button class="btn text danger small" data-cloud="delete-confirm" data-id="${p.id}" data-version="${p.version}">永久删除</button>`:`<button class="btn small" data-cloud="open" data-id="${p.id}">${p.id===info.current?.id?'进入':'打开'}</button><button class="btn text small" data-cloud="archive-confirm" data-id="${p.id}" data-version="${p.version}">归档</button>`}</div></div>`).join('')||'<div class="empty"><h3>这里还没有项目</h3><p>可以新建项目，或从 JSON 备份导入。</p></div>'}</div><div class="account-buttons account-bottom">${btn('new-project','＋ 新建项目','primary')}${btn('import','导入 JSON 备份')}${Cloud.guestDraft()?'<button class="btn" data-cloud="guest-confirm">导入本机体验数据</button>':''}</div>`);
 const signout=$('#cloudSignOut');if(signout)signout.addEventListener('click',e=>{if(Cloud.info().pending){e.preventDefault();toast('请先完成同步或下载本机备份，再退出登录');}});
}
$('#account').onclick=()=>showAccount().catch(e=>toast(e.message));
document.addEventListener('click',async event=>{
 const target=event.target.closest('[data-cloud]');if(!target)return;
 const action=target.dataset.cloud,id=target.dataset.id,version=Number(target.dataset.version);
 target.disabled=true;$('#dialogBody').inert=true;
 try{
  if(action==='list'||action==='archives'){await showAccount(action==='archives');return;}
  if(action==='open'){await Cloud.open(id);$('#dialog').close();toast('已载入云端项目');return;}
  if(action==='retry'){await Cloud.retry();await showAccount();return;}
  if(action==='fork'){await Cloud.fork(Jiancai.getState());$('#dialog').close();toast('本机修改已另存为独立云端项目');return;}
  if(action==='reload-confirm'){modal('重新载入云端项目',`<p>将先下载当前本机项目备份，再载入云端最新版本。未同步修改可从备份另行导入。</p><div class="form-actions">${btn('close','取消')}<button class="btn primary" data-cloud="reload">下载备份并重新载入</button></div>`);return;}
  if(action==='reload'){exportBackup();await Cloud.reload();$('#dialog').close();toast('已载入云端最新版本');return;}
  if(action==='archive-confirm'){modal('归档云端项目',`<p>归档后项目会移入「已归档」，以后可以恢复。账号下其他项目不受影响。</p><div class="form-actions">${btn('close','取消')}<button class="btn primary" data-cloud="archive" data-id="${id}" data-version="${version}">确认归档</button></div>`);return;}
  if(action==='archive'){await Cloud.archive(id,version);await showAccount();toast('项目已归档，可在已归档列表恢复');return;}
  if(action==='restore'){await Cloud.restore(id,version);$('#dialog').close();toast('项目已恢复并载入');return;}
  if(action==='delete-confirm'){modal('永久删除已归档项目',`<p>此操作会永久删除该项目及其底图，无法恢复。请确认已保存所需的 JSON 备份。</p><div class="form-actions">${btn('close','取消')}<button class="btn danger-fill" data-cloud="delete" data-id="${id}" data-version="${version}">永久删除</button></div>`);return;}
  if(action==='delete'){await Cloud.remove(id,version);await showAccount(true);toast('已永久删除归档项目');return;}
  if(action==='guest-confirm'){const draft=Cloud.guestDraft();if(!draft)throw Error('没有可导入的访客数据');modal('导入本机体验数据',`<p>将「${esc(draft.name)}」另存为当前账号的新项目。该数据来自当前浏览器的访客体验，请确认属于你希望保存的项目。</p><div class="form-actions">${btn('close','取消')}<button class="btn primary" data-cloud="guest-import">确认导入到当前账号</button></div>`);return;}
  if(action==='guest-import'){await Cloud.create(Cloud.guestDraft());$('#dialog').close();toast('本机体验数据已保存到当前账号');}
 }catch(e){toast(e.message);}finally{$('#dialogBody').inert=false;if(target.isConnected)target.disabled=false;}
});
