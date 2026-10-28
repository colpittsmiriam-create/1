import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {projectApi} from '../lib/project-api.mjs';
export function fixture(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
 const directory=new URL('../drizzle/',import.meta.url);
 for(const file of readdirSync(directory).filter(f=>f.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL(file,directory),'utf8').replaceAll('--> statement-breakpoint',''));
 const DB={failWhen:null,prepare(sql){return {sql,values:[],bind(...values){this.values=values;return this;},async first(){return sqlite.prepare(sql).get(...this.values)||null;},async all(){return {results:sqlite.prepare(sql).all(...this.values)};},async run(){const r=sqlite.prepare(sql).run(...this.values);return {meta:{changes:Number(r.changes)}};}};},async batch(statements){
  sqlite.exec('BEGIN IMMEDIATE');try{const result=statements.map(s=>{
   if(DB.failWhen?.(s.sql))throw Error('Injected database failure');
   const prepared=sqlite.prepare(s.sql);if(prepared.columns().length){return {results:prepared.all(...s.values),meta:{changes:0}};}
   const r=prepared.run(...s.values);return {results:[],meta:{changes:Number(r.changes)}};
  });sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}
 }};
 const objects=new Map(),BUCKET={async put(key,data,options){objects.set(key,{data:new Uint8Array(data),type:options.httpMetadata.contentType});},async get(key){const value=objects.get(key);return value?{arrayBuffer:async()=>value.data.buffer,httpMetadata:{contentType:value.type}}:null;},async delete(key){objects.delete(key);},async list(){return {objects:[]};}};
 const env={DB,BUCKET,API_LOGGER:()=>{}},alice={userId:'alice',displayName:'Alice',email:'alice@example.test'},bob={userId:'bob',displayName:'Bob',email:'bob@example.test'},charlie={userId:'charlie',displayName:'Charlie',email:'charlie@example.test'};
 const call=async(path,method='GET',body,user=alice,version=null,origin='https://test.example',extraHeaders={})=>{
  const request=new Request('https://test.example/api/'+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(version?{'If-Match':`"${version}"`}:{}),Origin:origin,...extraHeaders},...(body?{body:JSON.stringify(body)}:{})});
  const response=await projectApi(request,env,user,path.split('?')[0].split('/'));return {status:response.status,data:await response.json(),headers:response.headers};
 };
 return {call,objects,sqlite,env,DB,alice,bob,charlie};
}
