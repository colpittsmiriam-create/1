import {middleware,json,fail} from './middleware.mjs';
import {collections} from '../domain/project.mjs';
import * as service from '../services/projects.mjs';
import {openapi} from './openapi.mjs';
import {retryDeletedAssets} from '../services/assets.mjs';

export async function projectApi(request,env,user,segments=[]){return middleware(request,env,user,async ctx=>{
 const [resource,id,action,recordId,extra]=segments,method=request.method;
 if(resource==='session'&&method==='GET'&&segments.length===1)return json({user:user?{id:user.userId,name:user.displayName,email:user.email}:null,storageReady:!!env.DB&&!!env.BUCKET,signIn:'/signin-with-chatgpt?return_to=%2F',signOut:'/signout-with-chatgpt?return_to=%2F',backendVersion:'4.0'});
 if(resource==='health'&&method==='GET'&&segments.length===1){
  await ctx.db.prepare('SELECT 1 FROM project_versions LIMIT 1').first();
  if(env.BUCKET.list)await env.BUCKET.list({prefix:'health/',limit:1});return json({status:'ok',version:'4.0',storage:'relational'});
 }
 if(resource==='openapi'&&method==='GET'&&segments.length===1)return json(openapi);
 if(resource!=='projects')fail(404,'接口不存在','NOT_FOUND');
 ctx.afterCommit.push(()=>retryDeletedAssets(ctx));
 if(segments.length===1){if(method==='GET')return json(await service.listProjects(ctx));if(method==='POST')return json(await service.createProject(ctx),201);}
 if(segments.length===2){if(method==='GET')return json(await service.getProject(ctx,id));if(method==='PUT')return json(await service.updateProject(ctx,id));if(method==='DELETE')return json(await service.archiveProject(ctx,id));}
 if(segments.length===3){
  if(action==='settings'&&method==='PATCH')return json(await service.updateSettings(ctx,id));
  if(action==='restore'&&method==='POST')return json(await service.archiveProject(ctx,id,true));
  if(action==='permanent'&&method==='DELETE')return json(await service.deletePermanently(ctx,id));
  if(action==='calculate'&&method==='GET')return json(await service.preview(ctx,id));
  if(action==='planning-runs'){if(method==='POST')return json(await service.runPlanning(ctx,id),201);if(method==='GET')return json(await service.listRuns(ctx,id));}
  if((action==='submit'||action==='approve')&&method==='POST')return json(await service.workflow(ctx,id,action));
  if(action==='versions'&&method==='GET')return json(await service.versions(ctx,id));
  if(action==='audit-events'&&method==='GET')return json(await service.auditEvents(ctx,id));
 }
 if(action==='members'&&(segments.length===3||segments.length===4)&&['GET','POST','DELETE'].includes(method))return json(await service.members(ctx,id,recordId));
 if(action==='planning-runs'&&segments.length===4&&method==='GET')return json(await service.listRuns(ctx,id,recordId));
 if(action==='versions'&&extra==='restore'&&segments.length===5&&method==='POST')return json(await service.restoreVersion(ctx,id,recordId));
 if(collections[action]&&(segments.length===3||segments.length===4)){
  if(method==='GET')return json(await service.listEntities(ctx,id,action,recordId));
  if((segments.length===3&&method==='POST')||(segments.length===4&&['PATCH','DELETE'].includes(method)))return json(await service.mutateEntity(ctx,id,action,recordId));
 }
 fail(405,'接口不存在或不支持此方法','METHOD_NOT_ALLOWED');
});}
