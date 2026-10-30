import type {PoolClient} from 'pg';
type Queryable={query:PoolClient['query']};

// Principal at risk per collector and branch: outstanding on active loans plus principal of loans approved or in signing but not yet disbursed.
const PIPELINE=['awaiting_signature','signed_pending_approval','approved','signed','release_authorized','transfer_initiated'];
async function exposure(db:Queryable,column:'collector'|'branch',id:string,excludeApplicationId:string|null){
  const match=column==='collector'?'COALESCE(a.collector_id,a.officer_id)=$1':'a.branch_id=$1';
  const row=(await db.query(`SELECT
      COALESCE((SELECT SUM(l.debit-l.credit) FROM journal_lines l JOIN journals j ON j.id=l.journal_id JOIN applications a ON a.id=j.application_id
        WHERE ${match} AND a.status='active' AND l.account='principal_receivable'),0)::bigint
      +COALESCE((SELECT SUM(COALESCE(a.approved_principal,a.requested_principal)) FROM applications a WHERE ${match} AND a.status=ANY($2) AND a.id IS DISTINCT FROM $3),0)::bigint AS total`,
    [id,PIPELINE,excludeApplicationId])).rows[0];
  return Number(row.total);
}

// Throws when adding this principal would push the collector or branch over the policy limit (0 disables a limit).
export async function assertExposure(db:Queryable,policy:Record<string,any>,input:{collectorId:string;branchId:string;principal:number;applicationId?:string|null}){
  const officerLimit=Number(policy.max_officer_exposure??0),branchLimit=Number(policy.max_branch_exposure??0);
  if(officerLimit&&await exposure(db,'collector',input.collectorId,input.applicationId??null)+input.principal>officerLimit)throw new Error('Officer exposure limit reached');
  if(branchLimit&&await exposure(db,'branch',input.branchId,input.applicationId??null)+input.principal>branchLimit)throw new Error('Branch exposure limit reached');
}
