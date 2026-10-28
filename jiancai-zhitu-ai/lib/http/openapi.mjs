const responses={200:{description:'操作成功'},401:{description:'尚未登录'},403:{description:'角色或来源不允许'},409:{description:'版本冲突、重复请求或状态不允许'},422:{description:'字段或业务规则校验失败'},429:{description:'超过请求频率限制'}};
const match={name:'If-Match',in:'header',required:true,description:'项目当前版本，格式为带双引号的整数，例如 "3"',schema:{type:'string'}};
const idem={name:'Idempotency-Key',in:'header',required:false,description:'推荐为每个逻辑写请求生成 UUID；同键不同请求返回 409。保存于数据库，24 小时内可重试。',schema:{type:'string',minLength:8,maxLength:100}};
const body={required:true,content:{'application/json':{schema:{type:'object'}}}};
const operation=(summary,write=false,hasBody=false)=>({summary,description:'除健康、会话和接口文档外，接口需要托管平台登录；项目接口按 owner/editor/viewer 校验。写请求还要求同源 Origin。',responses, ...(write?{parameters:[match,idem]}:{}),...(hasBody?{requestBody:body}:{})});
const paths={
 '/api/session':{get:operation('当前会话与存储状态')},'/api/health':{get:operation('数据库与对象存储健康检查')},
 '/api/projects':{get:operation('分页列出拥有或获授权的项目'),post:{...operation('创建项目；body.project 为 schemaVersion=2 的项目对象',false,true),parameters:[idem]}},
 '/api/projects/{projectId}':{get:operation('读取关系化项目与底图'),put:operation('整体兼容保存；服务端重新校验并原子写入各业务表',true,true),delete:operation('所有者归档项目',true)},
 '/api/projects/{projectId}/settings':{patch:operation('更新项目基础信息、需求面积或选中堆场',true,true)},
 '/api/projects/{projectId}/restore':{post:operation('恢复已归档项目',true)},
 '/api/projects/{projectId}/permanent':{delete:operation('所有者永久删除已归档项目',true)},
 '/api/projects/{projectId}/calculate':{get:operation('计算预览；可传 taskId，不创建计算记录')},
 '/api/projects/{projectId}/planning-runs':{get:operation('分页读取计算历史'),post:operation('从数据库计算并持久化路线、点位成本与调度冲突；body.taskId 可选',true,true)},
 '/api/projects/{projectId}/planning-runs/{recordId}':{get:operation('读取计算结果及是否因模型更新而过期')},
 '/api/projects/{projectId}/submit':{post:operation('所有者提交复核；必须存在任务且通过工程规则检查',true)},
 '/api/projects/{projectId}/approve':{post:operation('所有者确认方案；需已提交复核且三项复核都有责任人记录',true)},
 '/api/projects/{projectId}/versions':{get:operation('分页读取服务端历史版本，保留最近 30 个数据版本')},
 '/api/projects/{projectId}/versions/{recordId}/restore':{post:operation('恢复历史为新的草稿版本，不覆盖历史记录',true)},
 '/api/projects/{projectId}/audit-events':{get:operation('分页读取操作审计，不含原始请求和底图')},
 '/api/projects/{projectId}/members':{get:operation('读取项目成员'),post:{...operation('所有者按已登录过本站的邮箱添加/修改 editor 或 viewer；body.email、body.role',false,true),parameters:[idem]}},
 '/api/projects/{projectId}/members/{recordId}':{delete:{...operation('所有者移除协作成员'),parameters:[idem]}}
};
for(const collection of ['nodes','roads','tasks','yards','restrictions','annotations']){
 paths[`/api/projects/{projectId}/${collection}`]={get:operation(`分页读取 ${collection}`),post:operation(`新增 ${collection}；body 为对应实体字段，可省略 id`,true,true)};
 paths[`/api/projects/{projectId}/${collection}/{recordId}`]={get:operation(`读取单条 ${collection}`),patch:operation(`部分更新 ${collection}，不允许修改 id`,true,true),delete:operation(`删除 ${collection}，存在引用时拒绝`,true)};
}
for(const [path,methods] of Object.entries(paths))for(const value of Object.values(methods)){
 const parameters=Array.from(path.matchAll(/\{([^}]+)\}/g),m=>({name:m[1],in:'path',required:true,schema:{type:'string'}}));
 value.parameters=[...parameters,...(value.parameters||[])];
 if(value.summary.includes('分页'))value.parameters.push({name:'limit',in:'query',schema:{type:'integer',minimum:1,maximum:100,default:25}},{name:'offset',in:'query',schema:{type:'integer',minimum:0,default:0}});
}
const number=(minimum=0,maximum=100000)=>({type:'number',minimum,maximum});
const text=(maxLength=40)=>({type:'string',minLength:1,maxLength});
const time={type:'string',pattern:'^([01][0-9]|2[0-3]):[0-5][0-9]$'};
const entity=(properties,required)=>({type:'object',additionalProperties:false,properties:{id:text(20),...properties},required});
const schemas={
 Node:entity({id:{...text(12),pattern:'^[A-Za-z0-9_-]+$'},label:text(),x:number(0,10000),y:number(0,10000)},['label','x','y']),
 Road:entity({from:text(12),to:text(12),length:number(.1),width:number(.1,50),closed:{type:'boolean',default:false}},['from','to','length','width']),
 Task:entity({name:text(),material:{enum:['砌块','钢筋','模板','砂石','其他']},start:text(12),end:text(12),trips:{type:'integer',minimum:1,maximum:100000},width:number(.1,50),speed:number(.1,10),handling:number(0,240),hourlyRate:number(),baseline:number(),windowStart:time,windowEnd:time,resource:text()},['name','material','start','end','trips','width','speed','handling','hourlyRate','baseline','windowStart','windowEnd','resource']),
 Yard:entity({name:text(),node:text(12),area:number(),relocation:number(0,10000000),approved:{type:'boolean',default:false}},['name','node','area','relocation']),
 Restriction:entity({name:text(),start:time,end:time,edgeIds:{type:'array',minItems:1,maxItems:1000,uniqueItems:true,items:text(20)}},['name','start','end','edgeIds']),
 Annotation:entity({id:text(30),label:text(50),x:number(0,10000),y:number(0,10000)},['label','x','y']),
 ApiError:{type:'object',required:['error','code','requestId'],properties:{error:{type:'string'},code:{type:'string'},requestId:{type:'string',format:'uuid'},details:{type:'array',items:{type:'object'}}}}
};
const names={nodes:'Node',roads:'Road',tasks:'Task',yards:'Yard',restrictions:'Restriction',annotations:'Annotation'};
for(const [collection,name] of Object.entries(names)){
 schemas[name+'Patch']={...schemas[name],required:[],minProperties:1};
 paths[`/api/projects/{projectId}/${collection}`].post.requestBody={required:true,content:{'application/json':{schema:{$ref:'#/components/schemas/'+name}}}};
 paths[`/api/projects/{projectId}/${collection}/{recordId}`].patch.requestBody={required:true,content:{'application/json':{schema:{$ref:'#/components/schemas/'+name+'Patch'}}}};
}
for(const methods of Object.values(paths))for(const operation of Object.values(methods)){
 operation.responses={...operation.responses};for(const status of [400,413,415,428,503])operation.responses[status]={description:'请求或服务错误',content:{'application/json':{schema:{$ref:'#/components/schemas/ApiError'}}}};
}
export const openapi={openapi:'3.1.0',info:{title:'建材智途 AI 业务 API',version:'4.0.0',description:'分层服务端、关系化业务数据库、平台登录与项目角色隔离。请求 JSON 最大 4 MB，模型正文 900 KB，底图 2 MB。错误响应带 code、error、requestId；版本冲突不覆盖已保存数据。'},paths,components:{schemas}};
