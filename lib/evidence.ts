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
