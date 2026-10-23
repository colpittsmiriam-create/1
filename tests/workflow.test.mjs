import test from 'node:test';
import assert from 'node:assert/strict';
import {elapsedSeconds,restoreSession,isDate,calendarDays,taskStatus,calendarExport} from '../dist/workflow.js';
import {seed,validateWorkspace} from '../dist/data.js';
test('wall clock timing catches delayed ticks and clamps to the goal',()=>{
 assert.equal(elapsedSeconds({running:true,seconds:8,baseSeconds:8,startedAt:1000,minutes:1},5200),12);
 assert.equal(elapsedSeconds({running:true,seconds:8,baseSeconds:8,startedAt:1000,minutes:1},100000),60);
 assert.equal(elapsedSeconds({running:false,seconds:8,baseSeconds:2,startedAt:null,minutes:1},100000),8);
});
test('draft recovery preserves elapsed time and always starts paused',()=>{
 const value={seconds:27,minutes:1,mode:'主动助力',intensity:30,patientId:'p1',checked:true,runId:'s1',startedDate:'2026-10-23',running:true};
 const restored=restoreSession(value,['p1']);
 assert.equal(restored.seconds,27);assert.equal(restored.running,false);assert.equal(restored.startedAt,null);assert.equal(restored.runId,'s1');
 assert.equal(restoreSession(value,['other']),null);
 assert.equal(restoreSession({...value,seconds:61},['p1']),null);
 assert.equal(restoreSession({...value,minutes:Infinity},['p1']),null);
 assert.equal(restoreSession({...value,seconds:0},['p1']),null);
});
test('calendar weeks start on Monday and handle leap years',()=>{
 assert.equal(calendarDays('2026-10')[0],'2026-09-28');assert.equal(calendarDays('2026-10').length,42);
 assert.ok(calendarDays('2028-02').includes('2028-02-29'));
 assert.equal(isDate('2026-02-29'),false);assert.equal(isDate('2028-02-29'),true);assert.equal(isDate('2026-13-01'),false);
});
test('completion takes precedence and same-day overdue uses time',()=>{
 const task={date:'2026-10-23',time:'08:00',done:false};
 assert.equal(taskStatus(task,'2026-10-23','09:00'),'已逾期');
 assert.equal(taskStatus({...task,done:true},'2026-10-23','09:00'),'已完成');
 assert.equal(taskStatus({...task,time:'10:00'},'2026-10-23','09:00'),'今日待办');
});
test('ICS converts Beijing time, escapes text and folds long UTF-8 lines',()=>{
 const text=calendarExport([{id:'task1',title:'复评,沟通;'+ '康复'.repeat(40),date:'2026-10-23',time:'09:00',patientId:'p',notes:'第一行\n第二行',done:false}],[{id:'p',name:'张'}],Date.UTC(2026,9,23));
 assert.ok(text.includes('DTSTART:20261023T010000Z'));
 assert.ok(text.includes('复评\\,沟通\\;'));assert.ok(text.includes('\\n第二行'));
 for(const line of text.split('\r\n'))assert.ok(Buffer.byteLength(line)<=75);
 assert.ok(text.endsWith('END:VCALENDAR\r\n'));
});
test('existing workspaces migrate without losing selected patient or tasks',()=>{
 const data=seed();data.settings.selectedPatient=data.patients[2].id;data.settings.lastBackupAt='2026/10/23';
 data.tasks.push({id:'t',title:'复评',date:'2026-10-23',time:'09:00',patientId:data.patients[0].id,done:false});
 const valid=validateWorkspace(data);assert.equal(valid.settings.selectedPatient,data.patients[2].id);assert.equal(valid.tasks.length,1);
 assert.throws(()=>validateWorkspace({...data,tasks:[{...data.tasks[0],date:'2026-02-30'}]}),/随访/);
 assert.throws(()=>validateWorkspace({...data,tasks:[{...data.tasks[0],time:'25:00'}]}),/随访/);
 assert.throws(()=>validateWorkspace({...data,tasks:[data.tasks[0],data.tasks[0]]}),/随访/);
});
