import {pool,transaction} from './db';
import {requireRole,type Actor} from './auth';

export type LocationState={active:boolean;enabled:boolean;consented_at:string|null;stopped_at:string|null;latitude:number|null;longitude:number|null;accuracy_m:number|null;reported_at:string|null};
export type MonitoredLocation=LocationState&{customer_id:string;customer_name:string};

async function hasActiveLoan(customerId:string,query:typeof pool.query){
  const result=await query('SELECT EXISTS(SELECT 1 FROM applications WHERE customer_id=$1 AND status=$2) AS active',[customerId,'active']);
  return Boolean(result.rows[0].active);
}

export async function customerLocation(actor:Actor):Promise<LocationState>{
  requireRole(actor,['customer']);
  const customerId=actor.customer_id!;
  const [active,share]=await Promise.all([
    hasActiveLoan(customerId,pool.query.bind(pool) as typeof pool.query),
    pool.query('SELECT enabled,consented_at,stopped_at,latitude,longitude,accuracy_m,reported_at FROM location_shares WHERE customer_id=$1',[customerId])
  ]);
  const row=share.rows[0];
  return {active,enabled:active&&Boolean(row?.enabled),consented_at:row?.consented_at??null,stopped_at:row?.stopped_at??null,
    latitude:active&&row?.enabled&&row.latitude!==null?Number(row.latitude):null,
    longitude:active&&row?.enabled&&row.longitude!==null?Number(row.longitude):null,
    accuracy_m:active&&row?.enabled?row.accuracy_m??null:null,reported_at:active&&row?.enabled?row.reported_at??null:null};
}

export async function setLocationConsent(actor:Actor,enabled:boolean){
  requireRole(actor,['customer']);
  const customerId=actor.customer_id!;
  return transaction(async client=>{
    if(enabled && !await hasActiveLoan(customerId,client.query.bind(client) as typeof pool.query)) throw new Error('Active loan required for location sharing');
    const before=(await client.query('SELECT enabled FROM location_shares WHERE customer_id=$1 FOR UPDATE',[customerId])).rows[0]?.enabled??false;
    const result=await client.query(`INSERT INTO location_shares(customer_id,enabled,consented_at,stopped_at,latitude,longitude,accuracy_m,reported_at)
      VALUES($1,$2,CASE WHEN $2 THEN now() ELSE NULL END,CASE WHEN $2 THEN NULL ELSE now() END,NULL,NULL,NULL,NULL)
      ON CONFLICT(customer_id) DO UPDATE SET enabled=$2,consented_at=CASE WHEN $2 THEN now() ELSE location_shares.consented_at END,
      stopped_at=CASE WHEN $2 THEN NULL ELSE now() END,latitude=NULL,longitude=NULL,accuracy_m=NULL,reported_at=NULL,updated_at=now()
      RETURNING enabled,consented_at,stopped_at`,[customerId,enabled]);
    await client.query('INSERT INTO audit_events(actor_id,subject_type,subject_id,action,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6)',
      [actor.id,'customer_location',customerId,enabled?'location_consent_granted':'location_consent_withdrawn',JSON.stringify({enabled:before}),JSON.stringify({enabled})]);
    return result.rows[0];
  });
}

export async function reportLocation(actor:Actor,latitude:number,longitude:number,accuracy:number){
  requireRole(actor,['customer']);
  if(![latitude,longitude,accuracy].every(Number.isFinite)||latitude < -90||latitude > 90||longitude < -180||longitude > 180||accuracy < 0||accuracy > 100000) throw new Error('Invalid location report');
  const customerId=actor.customer_id!;
  return transaction(async client=>{
    if(!await hasActiveLoan(customerId,client.query.bind(client) as typeof pool.query)) throw new Error('Active loan required for location sharing');
    const result=await client.query(`UPDATE location_shares SET latitude=$2,longitude=$3,accuracy_m=$4,reported_at=now(),updated_at=now()
      WHERE customer_id=$1 AND enabled=true RETURNING reported_at,latitude,longitude,accuracy_m`,
      [customerId,Math.round(latitude*1000)/1000,Math.round(longitude*1000)/1000,Math.max(150,Math.ceil(accuracy))]);
    if(!result.rows[0]) throw new Error('Location consent required');
    await client.query('INSERT INTO audit_events(actor_id,subject_type,subject_id,action,after_data) VALUES($1,$2,$3,$4,$5)',
      [actor.id,'customer_location',customerId,'location_reported',JSON.stringify({accuracy_m:result.rows[0].accuracy_m})]);
    return {...result.rows[0],latitude:Number(result.rows[0].latitude),longitude:Number(result.rows[0].longitude)};
  });
}

export async function monitorLocations(actor:Actor):Promise<MonitoredLocation[]>{
  requireRole(actor,['owner','manager']);
  const result=await pool.query(`SELECT c.id AS customer_id,c.name AS customer_name,
      COALESCE(s.enabled,false) AS enabled,s.consented_at,s.stopped_at,
      CASE WHEN s.enabled THEN s.latitude END AS latitude,CASE WHEN s.enabled THEN s.longitude END AS longitude,
      CASE WHEN s.enabled THEN s.accuracy_m END AS accuracy_m,CASE WHEN s.enabled THEN s.reported_at END AS reported_at
    FROM customers c LEFT JOIN location_shares s ON s.customer_id=c.id
    WHERE EXISTS(SELECT 1 FROM applications a WHERE a.customer_id=c.id AND a.status='active')
      AND ($1::text='owner' OR c.branch_id=$2::uuid)
    ORDER BY s.reported_at DESC NULLS LAST,c.name LIMIT 100`,[actor.role,actor.branch_id]);
  await pool.query('INSERT INTO audit_events(actor_id,subject_type,subject_id,action,after_data) VALUES($1,$2,$3,$4,$5)',
    [actor.id,'location_monitor',actor.id,'location_viewed',JSON.stringify({customerIds:result.rows.map(row=>row.customer_id)})]);
  return result.rows.map(row=>({...row,active:true,latitude:row.latitude===null?null:Number(row.latitude),longitude:row.longitude===null?null:Number(row.longitude)}));
}
