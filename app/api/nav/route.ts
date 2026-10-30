import {NextResponse} from 'next/server';
import {currentActor} from '@/lib/auth';
import {pool} from '@/lib/db';

// Sidebar badges: loans with an installment past due, and items waiting for a checker.
export async function GET(){
  const actor=await currentActor();
  if(!actor||actor.role==='customer')return NextResponse.json({error:'Silakan masuk terlebih dahulu'},{status:401});
  const scope=actor.role==='officer'?'AND COALESCE(a.collector_id,a.officer_id)=$1':actor.role==='manager'?'AND a.branch_id=$1':'';
  const params=actor.role==='owner'?[]:[actor.role==='officer'?actor.id:actor.branch_id];
  const [late,verify,branches]=await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS n FROM applications a WHERE a.status='active' ${scope}
      AND COALESCE((SELECT SUM(i.principal+i.interest) FROM installments i WHERE i.application_id=a.id AND i.due_at<(now() AT TIME ZONE 'Asia/Jakarta')::date),0)
        >COALESCE((SELECT SUM(p.principal+p.interest) FROM payments p WHERE p.application_id=a.id AND p.status<>'rejected'),0)`,params),
    actor.role==='officer'?Promise.resolve({rows:[{n:0}]}):pool.query(`SELECT
      (SELECT COUNT(*) FROM payments p JOIN applications a ON a.id=p.application_id WHERE p.status='pending' ${scope})
      +(SELECT COUNT(*) FROM cash_deposits a WHERE a.status='pending' ${actor.role==='manager'?'AND a.branch_id=$1':''}) AS n`,params),
    actor.role==='owner'?pool.query('SELECT id,name FROM branches ORDER BY name'):Promise.resolve({rows:[]})
  ]);
  return NextResponse.json({badges:{late:Number(late.rows[0].n),verify:Number(verify.rows[0].n)},branches:branches.rows},{headers:{'Cache-Control':'private, no-store'}});
}
