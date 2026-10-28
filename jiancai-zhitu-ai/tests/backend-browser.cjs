const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:5175';
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true}),context=await browser.newContext({viewport:{width:1440,height:1100},acceptDownloads:true}),p=await context.newPage(),errors=[],writes=[];
 p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(r.url().includes('/api/')&&r.method()!=='GET')writes.push(r.method()+' '+new URL(r.url()).pathname);});
 const snapshot=()=>p.evaluate(()=>Jiancai.getState()),info=()=>p.evaluate(()=>Cloud.info());
 const action=(name,id)=>p.locator(`[data-action="${name}"]${id?`[data-id="${id}"]`:''}`).first().click();
 const backend=(name,id)=>p.locator(`[data-backend="${name}"]${id?`[data-id="${id}"]`:''}`).first().click();
 const go=async name=>{await p.locator('#nav a[href="#'+name+'"]').click();};
 const saveModal=async()=>{await p.locator('dialog button[type=submit]').click();await p.locator('dialog').waitFor({state:'hidden'});};
 const close=()=>p.locator('#closeDialog').click();
 let projectId;
 try{
  await p.goto(base+'/signin-with-chatgpt?return_to=/');await p.waitForFunction(()=>Cloud.info().ready);await p.evaluate(()=>Cloud.create(JiancaiCore.createProject()));projectId=(await info()).current.id;
  await go('site');await action('toggle-road','R09');await p.waitForFunction(()=>Jiancai.getState().edges.find(e=>e.id==='R09').closed);assert.ok(writes.some(r=>r.endsWith('/roads/R09')));
  const server=await (await context.request.get(base+'/api/projects/'+projectId+'/calculate')).json();assert.equal(server.result.distance,160);console.log('PASS UI road edit uses entity API and changes database calculation');
  await action('toggle-road','R09');await p.waitForFunction(()=>!Jiancai.getState().edges.find(e=>e.id==='R09').closed);
  await action('tab','nodes');await action('add-node');await p.locator('dialog [name=id]').fill('M');await p.locator('dialog [name=label]').fill('后端验收节点');await saveModal();assert.ok((await snapshot()).nodes.some(n=>n.id==='M'));
  await action('delete-node','M');await action('confirm-delete-node','M');await p.waitForFunction(()=>!Jiancai.getState().nodes.some(n=>n.id==='M'));console.log('PASS UI node creation and deletion use relational services');
  await go('routes');await p.locator('[data-form=route] [name=trips]').fill('11');await p.locator('[data-form=route] button[type=submit]').click();await p.locator('#dialogTitle').filter({hasText:'场内物流方案校验'}).waitFor();assert.ok(writes.some(r=>r.endsWith('/planning-runs')));await close();
  const runs=await (await context.request.get(base+'/api/projects/'+projectId+'/planning-runs')).json();assert.ok(runs.total>=1);assert.equal(runs.items[0].stale,false);console.log('PASS route form persists task then creates server-side calculation record');
  await go('report');await backend('submit');await p.waitForFunction(()=>Cloud.info().current.workflowStatus==='in_review');
  for(let i=0;i<3;i++)await p.locator(`[data-review="${i}"]`).check();await p.evaluate(()=>Cloud.flush());await backend('approve');await p.waitForFunction(()=>Cloud.info().current.workflowStatus==='approved');console.log('PASS report submission, recorded review and server confirmation state');
  await go('site');await action('tab','roads');await action('toggle-road','R09');await p.waitForFunction(()=>Cloud.info().current.workflowStatus==='draft');assert.ok((await snapshot()).reviews.every(v=>!v));
  await backend('history');await p.locator('[data-backend=restore-confirm][data-id="1"]').click();await backend('restore','1');await p.locator('dialog').waitFor({state:'hidden'});assert.equal((await snapshot()).tasks[0].trips,10);assert.equal((await snapshot()).edges[8].closed,false);console.log('PASS history restoration creates a fresh draft and restores prior task/road data');
  await backend('members');await p.locator('[data-backend-form=member] [name=email]').fill('unknown-'+Date.now()+'@example.test');await p.locator('[data-backend-form=member] button[type=submit]').click();await p.locator('[data-backend-form=member] .form-error:not([hidden])').waitFor();assert.ok((await p.locator('[data-backend-form=member] .form-error').innerText()).includes('尚未登录'));await close();console.log('PASS member management validates real registered identities');
  const out=await fs.mkdtemp(path.join(os.tmpdir(),'jiancai-backend-'));await go('report');await p.screenshot({path:path.join(out,'report-workflow.png'),fullPage:true});
  for(const width of [390,768,1440]){await p.setViewportSize({width,height:900});for(const tab of ['overview','site','routes','yards','schedule','report']){await go(tab);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${width} ${tab}`);}}
  assert.deepEqual(errors,[]);console.log('PASS backend UI page layout at 18 viewport/page combinations');console.log('ALL BACKEND BROWSER CHECKS PASSED. Artifacts:',out);
 }finally{
  if(projectId){const read=await context.request.get(base+'/api/projects/'+projectId);if(read.ok()){const current=await read.json();const archive=await context.request.delete(base+'/api/projects/'+projectId,{headers:{Origin:base,'If-Match':`"${current.version}"`}});if(archive.ok()){const a=await archive.json();await context.request.delete(base+'/api/projects/'+projectId+'/permanent',{headers:{Origin:base,'If-Match':`"${a.version}"`}});}}}
  await browser.close();
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
