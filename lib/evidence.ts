import type {PoolClient} from 'pg';
import {pool} from './db';
import type {Actor} from './auth';
import {imageMime,protect,reveal,videoMime} from './protected-data';

export type IdentityDetails={nik:string;dateOfBirth:string;address:string;motherName:string;bankAccountNumber:string;accountHolder:string;occupation:string;loanPurpose:string};

export async function storeIntakeEvidence(client:PoolClient,applicationId:string,details:IdentityDetails,ktp:Uint8Array,liveness:Uint8Array){
  if(ktp.length<12||ktp.length>4*1024*1024) throw new Error('Invalid KTP photo size');
  if(liveness.length<12||liveness.length>12*1024*1024) throw new Error('Invalid liveness video size');
  const ktpMime=imageMime(ktp),livenessMime=videoMime(liveness);
  if(!ktpMime||!livenessMime) throw new Error('Unsupported evidence format');
  const identity=protect(Buffer.from(JSON.stringify(details),'utf8'));
  const photo=protect(ktp);
  const video=protect(liveness);
  await client.query(`INSERT INTO intake_evidence(application_id,details_cipher,details_iv,details_tag,
      ktp_cipher,ktp_iv,ktp_tag,ktp_mime,ktp_sha256,
      liveness_cipher,liveness_iv,liveness_tag,liveness_mime,liveness_sha256)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [applicationId,identity.cipher,identity.iv,identity.tag,photo.cipher,photo.iv,photo.tag,ktpMime,photo.sha256,
      video.cipher,video.iv,video.tag,livenessMime,video.sha256]);
}

export async function readIntakeEvidence(actor:Actor,applicationId:string,kind:'ktp'|'liveness'){
  if(actor.role!=='owner'&&actor.role!=='officer') throw new Error('Forbidden');
  const result=await pool.query(`SELECT a.officer_id,a.branch_id,e.* FROM intake_evidence e
    JOIN applications a ON a.id=e.application_id WHERE e.application_id=$1`,[applicationId]);
  const row=result.rows[0];
  if(!row||(actor.role==='officer'&&(row.officer_id!==actor.id||row.branch_id!==actor.branch_id))) throw new Error('Forbidden');
  const stem=kind==='ktp'?'ktp':'liveness';
  const data=reveal(row[`${stem}_cipher`],row[`${stem}_iv`],row[`${stem}_tag`]);
  await pool.query('INSERT INTO audit_events(actor_id,subject_type,subject_id,action,after_data) VALUES($1,$2,$3,$4,$5)',
    [actor.id,'application',applicationId,'identity_evidence_viewed',JSON.stringify({kind})]);
  return {data,mime:row[`${stem}_mime`] as string};
}

export type PlaceInput={photo:Uint8Array|null;latitude:number|null;longitude:number|null;accuracyM:number|null};

// Coordinates are rounded to three decimals (about 100 m), like the location feature.
export async function storePlace(client:PoolClient,applicationId:string,place:PlaceInput){
  const hasCoords=place.latitude!==null&&place.longitude!==null&&Math.abs(place.latitude)<=90&&Math.abs(place.longitude)<=180;
  if(!place.photo&&!hasCoords)return;
  let photo=null,mime=null;
  if(place.photo){
    if(place.photo.length<12||place.photo.length>4*1024*1024)throw new Error('Invalid place photo');
    mime=imageMime(place.photo);if(!mime)throw new Error('Invalid place photo');
    photo=protect(place.photo);
  }
  const round=(v:number|null)=>v===null?null:Math.round(v*1000)/1000;
  await client.query(`INSERT INTO intake_place(application_id,photo_cipher,photo_iv,photo_tag,photo_mime,photo_sha256,latitude,longitude,accuracy_m) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [applicationId,photo?.cipher??null,photo?.iv??null,photo?.tag??null,mime,photo?.sha256??null,hasCoords?round(place.latitude):null,hasCoords?round(place.longitude):null,
      hasCoords&&place.accuracyM!==null?Math.max(100,Math.round(place.accuracyM)):null]);
}

// Owners, managers of the branch, and the originating or collecting officer may view the site photo.
export async function readPlacePhoto(actor:Actor,applicationId:string){
  const row=(await pool.query(`SELECT a.officer_id,a.collector_id,a.branch_id,p.* FROM intake_place p JOIN applications a ON a.id=p.application_id WHERE p.application_id=$1`,[applicationId])).rows[0];
  if(!row?.photo_cipher)throw new Error('Not found');
  const allowed=actor.role==='owner'||(actor.role==='manager'&&row.branch_id===actor.branch_id)||(actor.role==='officer'&&(row.officer_id===actor.id||row.collector_id===actor.id));
  if(!allowed)throw new Error('Forbidden');
  await pool.query('INSERT INTO audit_events(actor_id,subject_type,subject_id,action) VALUES($1,$2,$3,$4)',[actor.id,'application',applicationId,'place_photo_viewed']);
  return {data:reveal(row.photo_cipher,row.photo_iv,row.photo_tag),mime:row.photo_mime as string};
}
