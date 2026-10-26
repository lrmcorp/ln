import {createHash,randomBytes} from 'node:crypto';
import {pool,transaction} from './db';
import type {Actor} from './auth';

const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const activeLoan=`EXISTS(SELECT 1 FROM applications WHERE customer_id=$1 AND status='active')`;
export const mobileBearer=(request:Request)=>request.headers.get('authorization')?.match(/^Bearer (lnm_[A-Za-z0-9_-]{43})$/)?.[1]??'';

export async function createMobileEnrollment(actor:Actor,applicationId:string){
  if(actor.role!=='owner'&&actor.role!=='officer')throw new Error('Forbidden');
  return transaction(async client=>{
    const app=(await client.query('SELECT id,customer_id,officer_id,branch_id,status FROM applications WHERE id=$1 FOR UPDATE',[applicationId])).rows[0];
    if(!app||(actor.role==='officer'&&(app.officer_id!==actor.id||app.branch_id!==actor.branch_id)))throw new Error('Forbidden');
    if(app.status!=='active')throw new Error('Active loan required');
    const code=randomBytes(18).toString('base64url');
    const enrollment=(await client.query(`INSERT INTO mobile_enrollments(application_id,customer_id,code_hash,issued_by,expires_at)
      VALUES($1,$2,$3,$4,now()+interval '24 hours') RETURNING id,expires_at`,
      [applicationId,app.customer_id,digest(code),actor.id])).rows[0];
    await client.query('INSERT INTO audit_events(actor_id,subject_type,subject_id,action,after_data) VALUES($1,$2,$3,$4,$5)',
      [actor.id,'mobile_enrollment',enrollment.id,'mobile_code_issued',JSON.stringify({applicationId,expiresAt:enrollment.expires_at})]);
    return {code,expiresAt:enrollment.expires_at};
  });
}

export async function activateMobileDevice(code:string){
  if(!/^[A-Za-z0-9_-]{24}$/.test(code))throw new Error('Invalid enrollment code');
  return transaction(async client=>{
    const enrollment=(await client.query(`SELECT id,customer_id FROM mobile_enrollments
      WHERE code_hash=$1 AND consumed_at IS NULL AND expires_at>now() FOR UPDATE`,[digest(code)])).rows[0];
    if(!enrollment)throw new Error('Invalid enrollment code');
    const active=(await client.query(`SELECT id FROM applications WHERE customer_id=$1 AND status='active' ORDER BY id LIMIT 1 FOR UPDATE`,[enrollment.customer_id])).rows[0];
    if(!active)throw new Error('Active loan required');
    await client.query('UPDATE mobile_devices SET revoked_at=now(),sharing_enabled=false WHERE customer_id=$1 AND revoked_at IS NULL',[enrollment.customer_id]);
    await client.query(`UPDATE location_shares SET enabled=false,stopped_at=now(),latitude=NULL,longitude=NULL,accuracy_m=NULL,reported_at=NULL,updated_at=now()
      WHERE customer_id=$1`,[enrollment.customer_id]);
    const token=`lnm_${randomBytes(32).toString('base64url')}`;
    const device=(await client.query('INSERT INTO mobile_devices(customer_id,enrollment_id,token_hash) VALUES($1,$2,$3) RETURNING id',
      [enrollment.customer_id,enrollment.id,digest(token)])).rows[0];
    await client.query('UPDATE mobile_enrollments SET consumed_at=now() WHERE id=$1',[enrollment.id]);
    await client.query('INSERT INTO audit_events(subject_type,subject_id,action,after_data) VALUES($1,$2,$3,$4)',
      ['mobile_device',device.id,'mobile_activated',JSON.stringify({customerId:enrollment.customer_id})]);
    return {token};
  });
}

async function deviceFromToken(token:string){
  if(!/^lnm_[A-Za-z0-9_-]{43}$/.test(token))throw new Error('Invalid device token');
  const row=(await pool.query('SELECT id,customer_id,sharing_enabled FROM mobile_devices WHERE token_hash=$1 AND revoked_at IS NULL',[digest(token)])).rows[0];
  if(!row)throw new Error('Invalid device token');
  return row as {id:string;customer_id:string;sharing_enabled:boolean};
}

export async function mobileDeviceStatus(token:string){
  const device=await deviceFromToken(token);
  const result=await pool.query(`SELECT ${activeLoan} AS active,
    EXISTS(SELECT 1 FROM location_shares WHERE customer_id=$1 AND enabled=true) AS server_enabled`,[device.customer_id]);
  return {active:Boolean(result.rows[0].active),enabled:Boolean(device.sharing_enabled&&result.rows[0].server_enabled),intervalSeconds:30};
}

export async function setMobileConsent(token:string,enabled:boolean){
  const device=await deviceFromToken(token);
  return transaction(async client=>{
    const row=(await client.query('SELECT id,customer_id,sharing_enabled FROM mobile_devices WHERE id=$1 AND revoked_at IS NULL FOR UPDATE',[device.id])).rows[0];
    if(!row)throw new Error('Invalid device token');
    if(enabled&&!(await client.query(`SELECT ${activeLoan} AS active`,[row.customer_id])).rows[0].active)throw new Error('Active loan required');
    await client.query('UPDATE mobile_devices SET sharing_enabled=$2,consented_at=CASE WHEN $2 THEN now() ELSE consented_at END,last_seen_at=now() WHERE id=$1',[row.id,enabled]);
    await client.query(`INSERT INTO location_shares(customer_id,enabled,consented_at,stopped_at)
      VALUES($1,$2,CASE WHEN $2 THEN now() END,CASE WHEN $2 THEN NULL ELSE now() END)
      ON CONFLICT(customer_id) DO UPDATE SET enabled=$2,
      consented_at=CASE WHEN $2 THEN now() ELSE location_shares.consented_at END,
      stopped_at=CASE WHEN $2 THEN NULL ELSE now() END,
      latitude=NULL,longitude=NULL,accuracy_m=NULL,reported_at=NULL,updated_at=now()`,[row.customer_id,enabled]);
    await client.query('INSERT INTO audit_events(subject_type,subject_id,action,before_data,after_data) VALUES($1,$2,$3,$4,$5)',
      ['mobile_device',row.id,enabled?'mobile_location_consented':'mobile_location_withdrawn',JSON.stringify({enabled:row.sharing_enabled}),JSON.stringify({enabled})]);
    return {enabled};
  });
}

export async function reportMobileLocation(token:string,latitude:number,longitude:number,accuracy:number){
  if(![latitude,longitude,accuracy].every(Number.isFinite)||latitude< -90||latitude>90||longitude< -180||longitude>180||accuracy<0||accuracy>100000)throw new Error('Invalid location report');
  const device=await deviceFromToken(token);
  return transaction(async client=>{
    const row=(await client.query('SELECT id,customer_id,sharing_enabled FROM mobile_devices WHERE id=$1 AND revoked_at IS NULL FOR UPDATE',[device.id])).rows[0];
    if(!row||!row.sharing_enabled)throw new Error('Location consent required');
    if(!(await client.query(`SELECT ${activeLoan} AS active`,[row.customer_id])).rows[0].active)throw new Error('Active loan required');
    const location=(await client.query(`UPDATE location_shares SET latitude=$2,longitude=$3,accuracy_m=$4,reported_at=now(),updated_at=now()
      WHERE customer_id=$1 AND enabled=true RETURNING latitude,longitude,accuracy_m,reported_at`,
      [row.customer_id,Math.round(latitude*1000)/1000,Math.round(longitude*1000)/1000,Math.max(150,Math.ceil(accuracy))])).rows[0];
    if(!location)throw new Error('Location consent required');
    await client.query('UPDATE mobile_devices SET last_seen_at=now() WHERE id=$1',[row.id]);
    await client.query('INSERT INTO audit_events(subject_type,subject_id,action,after_data) VALUES($1,$2,$3,$4)',
      ['mobile_device',row.id,'mobile_location_reported',JSON.stringify({accuracy_m:location.accuracy_m})]);
    return {latitude:Number(location.latitude),longitude:Number(location.longitude),accuracy_m:location.accuracy_m,reported_at:location.reported_at};
  });
}
