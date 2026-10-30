'use client';
// Requests recorded without signal wait in IndexedDB and are sent in order when the device is back online.
// Files are stored as Blobs. A 409 on resend means the first attempt already reached the server, so it counts as sent.
type Stored={id:string;path:string;label:string;createdAt:string;json?:unknown;form?:[string,string|Blob,string?][]};
const DB='ln-offline',STORE='queue',EVENT='ln-offline-change';

function open(){
  return new Promise<IDBDatabase>((resolve,reject)=>{
    const request=indexedDB.open(DB,1);
    request.onupgradeneeded=()=>request.result.createObjectStore(STORE,{keyPath:'id'});
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
}
async function tx<T>(mode:IDBTransactionMode,run:(store:IDBObjectStore)=>IDBRequest<T>){
  const db=await open();
  return new Promise<T>((resolve,reject)=>{const request=run(db.transaction(STORE,mode).objectStore(STORE));request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
}

export async function queueRequest(path:string,body:unknown,label:string){
  const item:Stored={id:`${Date.now()}-${Math.random().toString(36).slice(2)}`,path,label,createdAt:new Date().toISOString()};
  if(body instanceof FormData)item.form=[...body.entries()].map(([key,value])=>value instanceof File?[key,value,value.name]:[key,value]);
  else item.json=body;
  await tx('readwrite',store=>store.put(item));
  window.dispatchEvent(new Event(EVENT));
}

export async function queued(){try{return await tx<Stored[]>('readonly',store=>store.getAll());}catch{return [];}}

let flushing=false;
// Sends queued requests oldest first; stops at the first network failure so order is kept.
export async function flushQueue(){
  if(flushing||!navigator.onLine)return {sent:0,failed:[] as string[]};
  flushing=true;const failed:string[]=[];let sent=0;
  try{
    for(const item of (await queued()).sort((a,b)=>a.createdAt.localeCompare(b.createdAt))){
      let response:Response;
      try{
        if(item.form){const body=new FormData();for(const [key,value,name] of item.form)value instanceof Blob?body.append(key,value,name):body.append(key,value);response=await fetch(item.path,{method:'POST',body});}
        else response=await fetch(item.path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(item.json)});
      }catch{break;}
      if(response.status===401||response.status>=500)break;
      if(!response.ok&&response.status!==409){const result=await response.json().catch(()=>({}));failed.push(`${item.label}: ${result.error??'ditolak server'}`);}
      else sent++;
      await tx('readwrite',store=>store.delete(item.id));
    }
  }finally{flushing=false;window.dispatchEvent(new Event(EVENT));}
  return {sent,failed};
}

export const offlineEvent=EVENT;
export const isNetworkError=(error:unknown)=>error instanceof TypeError||!navigator.onLine;
