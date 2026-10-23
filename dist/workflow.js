// Pure helpers shared by the website and the offline release.
export const SESSION_KEY='xinhuyun-session-v1';
export const RECOVERY_KEY='xinhuyun-recovery-v1';
export function elapsedSeconds(session,now=Date.now()){
 const base=Number.isFinite(session.baseSeconds)?session.baseSeconds:session.seconds;
 return Math.min(session.minutes*60,Math.max(0,session.running&&session.startedAt?base+Math.floor(Math.max(0,now-session.startedAt)/1000):session.seconds));
}
export function restoreSession(value,patientIds){
 if(!value||!patientIds.includes(value.patientId)||!Number.isInteger(value.seconds)||value.seconds<1||!Number.isInteger(value.minutes)||value.minutes<1||value.minutes>60||value.seconds>value.minutes*60||!['被动训练','主动助力','阻力训练'].includes(value.mode)||!Number.isFinite(value.intensity)||value.intensity<5||value.intensity>60)return null;
 return {seconds:value.seconds,baseSeconds:value.seconds,minutes:value.minutes,mode:value.mode,intensity:value.intensity,patientId:value.patientId,checked:!!value.checked,runId:typeof value.runId==='string'?value.runId.slice(0,80):null,startedDate:isDate(value.startedDate)?value.startedDate:null,running:false,startedAt:null,interval:null};
}
export function isDate(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const date=new Date(value+'T00:00:00Z');return Number.isFinite(date.valueOf())&&date.toISOString().slice(0,10)===value;
}
export function calendarDays(month){
 const [year,m]=month.split('-').map(Number),first=new Date(Date.UTC(year,m-1,1)),offset=(first.getUTCDay()+6)%7;
 return Array.from({length:42},(_,i)=>new Date(Date.UTC(year,m-1,1-offset+i)).toISOString().slice(0,10));
}
export function taskStatus(task,date,time){
 if(task.done)return '已完成';
 if(task.date<date||(task.date===date&&task.time<time))return '已逾期';
 return task.date===date?'今日待办':'待开始';
}
const icsEscape=value=>String(value??'').replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
const utc=value=>new Date(value).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
function foldCalendarLine(line){
 const lines=[];let part='',size=0;
 for(const char of line){const len=new TextEncoder().encode(char).length;if(size+len>73){lines.push(part);part=' '+char;size=1+len}else{part+=char;size+=len}}
 return [...lines,part].join('\r\n');
}
export function calendarExport(tasks,patients,now=Date.now()){
 const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Xinhuyun//Follow-up Calendar//ZH','CALSCALE:GREGORIAN','METHOD:PUBLISH','X-WR-CALNAME:芯护云随访计划'];
 for(const task of tasks){
  if(!isDate(task.date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(task.time))continue;
  const start=Date.parse(task.date+'T'+task.time+':00+08:00'),name=patients.find(p=>p.id===task.patientId)?.name||'体验档案';
  lines.push('BEGIN:VEVENT','UID:'+icsEscape(task.id)+'@xinhuyun.local','DTSTAMP:'+utc(now),'DTSTART:'+utc(start),'DTEND:'+utc(start+1800000),'SUMMARY:'+icsEscape(task.title),'DESCRIPTION:'+icsEscape(name+' · '+(task.kind||'随访提醒')+'\n'+(task.notes||'')+'\n来源：芯护云本地体验计划。'),'STATUS:'+ (task.done?'CONFIRMED':'TENTATIVE'),'END:VEVENT');
 }
 lines.push('END:VCALENDAR');return lines.map(foldCalendarLine).join('\r\n')+'\r\n';
}
