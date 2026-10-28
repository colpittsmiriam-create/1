const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:5175';
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const artifact=await fs.mkdtemp(path.join(os.tmpdir(),'jiancai-cloud-'));const errors=[];
 async function tab(context,login=false){const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(base+(login?'/signin-with-chatgpt?return_to=/':'/'));await p.waitForFunction(()=>window.Cloud?.info().ready);await p.locator('#main:not([inert])').waitFor();return p;}
 const data=p=>p.evaluate(()=>Jiancai.getState());
 const flush=p=>p.evaluate(()=>Cloud.flush());
 async function editName(p,name){await p.goto(base+'/platform/index.html#site');await p.waitForFunction(()=>window.Cloud?.info().ready);await p.locator('[data-form=site] [name=name]').fill(name);await p.locator('[data-form=site] button[type=submit]').click();}
 const click=(p,action,id)=>action==='close'?p.locator('#closeDialog').click():p.locator(`[data-action="${action}"]${id?`[data-id="${id}"]`:''}`).first().click();
 const cloudClick=(p,action,id)=>p.locator(`[data-cloud="${action}"]${id?`[data-id="${id}"]`:''}`).first().click();
 try{
  const a=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:1000}}),guest=await tab(a);
  assert.equal((await a.request.get(base+'/api/projects')).status(),401);await editName(guest,'访客体验数据');await guest.reload();await guest.waitForFunction(()=>Cloud.info().ready);assert.equal((await data(guest)).name,'访客体验数据');
  await guest.locator('#account').click();assert.ok((await guest.locator('a[target=_top]').getAttribute('href')).startsWith('/signin-with-chatgpt'));await click(guest,'close');console.log('PASS public guest mode and sign-in entry');
  const p=await tab(a,true);assert.ok((await p.evaluate(()=>Cloud.info())).user);const original=(await p.evaluate(()=>Cloud.info())).current.id;
  const name='云端测试_'+Date.now();await editName(p,name);await flush(p);assert.equal((await a.request.get(base+'/api/projects/'+original)).status(),200);assert.equal((await (await a.request.get(base+'/api/projects/'+original)).json()).project.name,name);
  const b=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:1000}}),q=await tab(b,true);await q.evaluate(id=>Cloud.open(id),original);assert.equal((await data(q)).name,name);console.log('PASS authenticated cloud save and second-device read');
  await p.goto(base+'/platform/index.html#site');await p.waitForFunction(()=>Cloud.info().ready);await p.locator('#siteFile').setInputFiles({name:'图纸.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=','base64')});await p.waitForFunction(()=>Jiancai.getState().background);await flush(p);
  await q.evaluate(()=>Cloud.reload());assert.ok((await data(q)).background);console.log('PASS persistent background across devices');
  await editName(p,name+'_最新');await flush(p);
  // Keep q open at its stale version; editing this form must not overwrite p.
  await q.locator('#nav a[href="#site"]').click();await q.locator('[data-form=site] [name=name]').fill(name+'_本机');await q.locator('[data-form=site] button[type=submit]').click();await q.waitForFunction(()=>Cloud.info().blocked);assert.equal(await q.evaluate(()=>Cloud.info().blocked),true);
  assert.equal((await (await a.request.get(base+'/api/projects/'+original)).json()).project.name,name+'_最新');
  await q.locator('#account').click();await cloudClick(q,'fork');await q.waitForFunction(id=>Cloud.info().current.id!==id,original);const forkId=await q.evaluate(()=>Cloud.info().current.id);assert.equal((await data(q)).name,name+'_本机');console.log('PASS conflict protection and save as a new project');
  await q.locator('#account').click();await cloudClick(q,'archive-confirm',forkId);await cloudClick(q,'archive',forkId);await cloudClick(q,'archives');await q.locator(`[data-cloud=restore][data-id="${forkId}"]`).waitFor();await cloudClick(q,'restore',forkId);await q.waitForFunction(id=>Cloud.info().current.id===id,forkId);console.log('PASS project archive and restore');
  await b.setOffline(true);await q.locator('#nav a[href="#site"]').click();await q.locator('[data-form=site] [name=name]').fill(name+'_离线');await q.locator('[data-form=site] button[type=submit]').click();assert.ok((await q.locator('#saveStatus').innerText()).includes('离线'));
  await b.setOffline(false);await flush(q);assert.equal((await (await b.request.get(base+'/api/projects/'+forkId)).json()).project.name,name+'_离线');console.log('PASS offline draft and reconnection retry');
  await q.locator('#account').click();await q.locator('dialog [data-action=new-project]').click();await q.locator('dialog [name=name]').fill(name+'_新建');await q.locator('dialog button[type=submit]').click();await q.waitForFunction(id=>Cloud.info().current.id!==id,forkId);const newId=await q.evaluate(()=>Cloud.info().current.id);assert.equal((await data(q)).tasks.length,0);
  assert.equal((await (await b.request.get(base+'/api/projects/'+forkId)).json()).project.name,name+'_离线');console.log('PASS creating a project preserves previous cloud projects');
  for(const width of [390,768,1440]){await q.setViewportSize({width,height:900});for(const hash of ['overview','site','routes','yards','schedule','report']){await q.goto(base+'/platform/index.html#'+hash);await q.waitForFunction(()=>Cloud.info().ready);assert.equal(await q.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${width} ${hash}`);}}
  await q.setViewportSize({width:1440,height:1000});await q.locator('#account').click();await q.screenshot({path:path.join(artifact,'cloud-projects.png'),fullPage:true});console.log('PASS cloud UI on desktop, tablet and mobile');
  await click(q,'close');await q.goto(base+'/signout-with-chatgpt?return_to=/');await q.waitForFunction(()=>Cloud.info().ready);assert.equal(await q.evaluate(()=>Cloud.info().user),null);assert.notEqual((await data(q)).name,name+'_新建');console.log('PASS sign-out does not expose account drafts to guest');
  // Remove only projects created by this test. They are not user data.
  for(const id of [forkId,newId]){const get=await a.request.get(base+'/api/projects/'+id);if(get.ok()){const row=await get.json();const archived=await a.request.delete(base+'/api/projects/'+id,{headers:{Origin:base,'If-Match':`"${row.version}"`}});if(archived.ok()){const value=await archived.json();await a.request.delete(base+'/api/projects/'+id+'/permanent',{headers:{Origin:base,'If-Match':`"${value.version}"`}});}}}
  assert.deepEqual(errors,[]);await a.close();await b.close();console.log('ALL CLOUD BROWSER CHECKS PASSED. Artifacts:',artifact);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
