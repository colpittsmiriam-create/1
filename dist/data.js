export const STORAGE_KEY='xinhuyun-workspace-v1';
export const localDate=(date=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
export let today=localDate();
export function refreshDay(){today=localDate();return today}
export function seed(){
 const patients=[
  {id:'DEMO-001',name:'张先生',age:58,sex:'男',diagnosis:'脑卒中后手功能障碍',side:'右手',stage:'恢复期',status:'训练中',score:42,baseline:31,progress:68,device:'ZX-001',location:'院内',color:'#edf4f9'},
  {id:'DEMO-002',name:'李女士',age:64,sex:'女',diagnosis:'脑卒中后手功能障碍',side:'左手',stage:'早期',status:'待评估',score:24,baseline:20,progress:35,device:'ZX-002',location:'院内',color:'#f3eff9'},
  {id:'DEMO-003',name:'王女士',age:52,sex:'女',diagnosis:'腕部骨折术后',side:'右手',stage:'巩固期',status:'居家训练',score:54,baseline:40,progress:82,device:'ZX-003',location:'居家',color:'#f7f2e8'},
  {id:'DEMO-004',name:'陈先生',age:47,sex:'男',diagnosis:'手部外伤术后',side:'右手',stage:'恢复期',status:'待复核',score:36,baseline:28,progress:56,device:'ZX-004',location:'社区',color:'#edf5ee'},
  {id:'DEMO-005',name:'赵女士',age:61,sex:'女',diagnosis:'桡骨远端骨折术后',side:'左手',stage:'恢复期',status:'居家训练',score:48,baseline:38,progress:74,device:'ZX-005',location:'居家',color:'#f9eeed'},
  {id:'DEMO-006',name:'周先生',age:69,sex:'男',diagnosis:'脑卒中后手功能障碍',side:'右手',stage:'早期',status:'待评估',score:20,baseline:16,progress:28,device:'',location:'社区',color:'#edf3f7'}
 ];
 const sessions=[];
 for(let day=13;day>=0;day--){const d=localDate(new Date(Date.now()-day*86400000));patients.forEach((p,i)=>{if((day+i)%4!==0)sessions.push({id:`seed-${day}-${i}`,patientId:p.id,date:d,mode:['主动助力','被动训练','阻力训练'][i%3],seconds:900+(i*70+day*19)%400,completion:74+(day+i*3)%26,feeling:'无明显不适',source:'示例训练',time:`${9+i}:30`});});}
 const assessments=patients.map(p=>({id:'a-'+p.id,patientId:p.id,date:today,score:p.score,wrist:35,grip:8.2,notes:'示例评估，由专业人员评定后录入。',assessor:'示例康复师'}));
 const devices=patients.filter(p=>p.device).map((p,i)=>({id:p.device,name:i%2?'肌电采集器':'肌电采集器 + 康复手套',patientId:p.id,battery:92-i*13,status:i===3?'需巡检':'模拟在线',firmware:'原型 v0.9',maintenance:[]}));
 return {version:1,patients,sessions,assessments,devices,plans:[],reports:[],notes:[],messages:[],tasks:[],audit:[],checks:{},settings:{large:false,remind:'09:00'}};
}
export function validateWorkspace(d){
 if(!d||d.version!==1)throw Error('备份版本不受支持');
 for(const k of ['patients','sessions','assessments','devices','plans','reports','notes','messages','tasks','audit'])if(!Array.isArray(d[k])||d[k].length>20000)throw Error('备份数据不完整或记录过多');
 const str=(v,max=500)=>typeof v==='string'&&v.length<=max;
 const num=(v,min,max)=>Number.isFinite(v)&&v>=min&&v<=max;
 const ids=new Set();
 for(const p of d.patients){if(!str(p.id,80)||ids.has(p.id)||!str(p.name,50)||!str(p.diagnosis,200)||!str(p.side,20)||!str(p.stage,20)||!str(p.status,20)||!str(p.location,20)||!str(p.device,80)||!str(p.sex,10)||!num(p.age,1,120)||!num(p.score,0,66)||!num(p.baseline,0,66)||!num(p.progress,0,100))throw Error('备份档案格式有误');ids.add(p.id);}
 for(const s of d.sessions)if(!ids.has(s.patientId)||!str(s.id,100)||!str(s.date,20)||!str(s.mode,30)||!str(s.source,100)||!str(s.feeling,500)||!num(s.seconds,0,86400)||!num(s.completion,0,100))throw Error('训练记录格式有误');
 for(const a of d.assessments)if(!ids.has(a.patientId)||!num(a.score,0,66)||!str(a.date,20)||!str(a.notes,2000)||!str(a.assessor,100))throw Error('评估记录格式有误');
 for(const dev of d.devices)if(!str(dev.id,80)||!str(dev.name,100)||!str(dev.status,30)||!str(dev.firmware,50)||!Array.isArray(dev.maintenance)||!num(dev.battery,0,100))throw Error('设备格式有误');
 for(const n of d.notes)if(!str(n.text,5000)||!str(n.date,50))throw Error('备注格式有误');
 for(const m of d.messages)if(!str(m.text,5000)||!str(m.date,50)||!str(m.from,50))throw Error('消息格式有误');
 for(const p of d.plans)if(!ids.has(p.patientId)||!str(p.id,100)||!str(p.mode,30)||!str(p.status,30)||!num(p.minutes,1,60)||!num(p.intensity,0,100)||!str(p.reason,3000)||!str(p.date,50))throw Error('方案格式有误');
 for(const r of d.reports)if(!str(r.text,50000)||!str(r.id,100)||!str(r.date,50)||!str(r.status,30))throw Error('报告格式有误');
 const taskIds=new Set();
 for(const t of d.tasks){if(!str(t.id,100)||taskIds.has(t.id)||!str(t.title,200)||!/^\d{4}-\d{2}-\d{2}$/.test(t.date)||!Number.isFinite(Date.parse(t.date+'T00:00:00Z'))||new Date(t.date+'T00:00:00Z').toISOString().slice(0,10)!==t.date||!/^([01]\d|2[0-3]):[0-5]\d$/.test(t.time)||!ids.has(t.patientId)||(t.notes!=null&&!str(t.notes,2000))||(t.kind!=null&&!str(t.kind,30)))throw Error('随访格式有误');taskIds.add(t.id);t.done=!!t.done;}
 d.settings={large:!!d.settings?.large,remind:/^([01]\d|2[0-3]):[0-5]\d$/.test(d.settings?.remind)?d.settings.remind:'09:00',selectedPatient:ids.has(d.settings?.selectedPatient)?d.settings.selectedPatient:null,onboardingHidden:!!d.settings?.onboardingHidden,lastBackupAt:typeof d.settings?.lastBackupAt==='string'?d.settings.lastBackupAt.slice(0,50):null};d.checks=typeof d.checks==='object'&&d.checks?d.checks:{};
 return d;
}
export const articles=[
 {id:'wear',category:'设备指引',title:'第一次使用，先做好这些准备',description:'从皮肤检查到电极佩戴，了解训练前的准备流程。',icon:'device',sections:[['训练前检查','按照设备说明书和康复师指导检查皮肤、电极、连接线与设备外观。皮肤出现破损、红肿或不适时，先咨询专业人员。'],['佩戴与定位','电极与手套的具体位置由设备型号和目标肌群决定。请由康复师首次示范并标记，不凭网络示意图自行确定贴放位置。'],['本平台如何体验','公开版使用模拟信号，训练页面不会控制真实硬件。可在肌电分析页面导入符合模板的 CSV 采样数据，体验波形与特征计算。']]},
 {id:'train',category:'训练课堂',title:'把每一次训练，变成可追踪的进步',description:'认识训练模式、过程记录和训练后的感受反馈。',icon:'activity',sections:[['先确认训练计划','被动、主动助力和阻力模式适用于不同情况。模式、时长及强度由专业人员结合评估确定，公开体验中的参数仅供操作演示。'],['记录过程与感受','记录实际训练时间、完成度及不适感，比单看训练次数更能帮助后续沟通。公开版训练记录保存在当前浏览器。'],['出现不适时','出现疼痛、异常疲劳、麻木加重或设备异常时停止训练，联系康复师。不要自行增加强度或依赖波形判断是否继续。']]},
 {id:'fma',category:'评估知识',title:'如何看懂 FMA 上肢评分记录',description:'区分评估得分、训练完成率与临床康复结论。',icon:'report',sections:[['分数由谁评定','平台记录 FMA 上肢运动功能总分，范围为 0–66 分。完整量表的实施与逐项评分应由受训评估人员完成。'],['趋势如何理解','分数变化可与训练记录、患者感受和其他评估一起查看。一次分数变化或单一训练指标不等于确定的临床疗效。'],['平台的记录方式','本平台提供人工总分录入、历史趋势和报告整理，不提供自动诊断或用肌电值替代 FMA 评定。']]},
 {id:'clean',category:'设备指引',title:'设备清洁与日常维护',description:'建立检查和维护记录，让设备使用过程更清晰。',icon:'shield',sections:[['按照说明书清洁','清洁前关闭电源，按对应设备的清洁与消毒说明操作。电子部件不要浸水；一次性与重复使用耗材应按各自要求处理。'],['发现异常及时停用','发现导线破损、外壳开裂、异常发热或无法解释的信号中断，应暂停使用并联系设备维护人员。'],['记录维护事项','在设备管理中记录检查日期、问题和处理结果。公开版维护记录用于体验，不会远程修复或校准真实设备。']]},
 {id:'home',category:'居家照护',title:'出院以后，康复记录如何接续',description:'把日常训练、阶段复评和照护沟通连成一条线。',icon:'home',sections:[['保留明确的出院计划','与照护团队确认训练目标、复评时间及遇到问题时的联系渠道。把明确的医嘱转换为便于执行的任务。'],['让沟通更具体','记录日期、训练模式、实际时长、完成情况和感受，复诊时一起提供给康复师。必要时带上设备信息。'],['公开版的数据范围','院内与居家视图共享当前浏览器的同一个体验档案，切换角色不代表远程登录。跨设备可用备份文件手动迁移；目前没有真实医患消息服务。']]},
 {id:'emg',category:'肌电科普',title:'肌电波形可以告诉我们什么',description:'了解信号特征与数据质量，建立对分析结果的合理预期。',icon:'wave',sections:[['认识表面肌电','表面肌电记录肌肉电活动，波形受电极位置、皮肤状态、采集设备与动作影响。不同设备与条件的数据不能简单直接比较。'],['本平台计算什么','对导入的 mV 采样计算 RMS、平均绝对值、峰峰值与过零率，并显示平直、异常跳变、削顶等启发式数据质量提示。'],['分析边界','数据质量规则不是医学异常识别模型，不能据此诊断肌肉疲劳、震颤、神经损伤或肌力等级。临床解释需结合标准采集、验证模型与专业评估。']]}
];
