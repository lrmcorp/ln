// Borrower grade from the worst lateness on any of the customer's disbursed loans; shared by server and client.
export type Grade='A'|'B'|'C'|'D'|'Baru';
export type GradeHistory={loans:number;worstDpd:number;writtenOff:boolean};
export function borrowerGrade({loans,worstDpd,writtenOff}:GradeHistory):{grade:Grade;label:string}{
  if(writtenOff||worstDpd>30)return {grade:'D',label:writtenOff?'Pernah dihapusbukukan':`Pernah terlambat ${worstDpd} hari`};
  if(!loans)return {grade:'Baru',label:'Belum ada riwayat'};
  if(worstDpd===0)return {grade:'A',label:'Selalu tepat waktu'};
  if(worstDpd<=7)return {grade:'B',label:`Terlambat paling lama ${worstDpd} hari`};
  return {grade:'C',label:`Terlambat paling lama ${worstDpd} hari`};
}
// SQL columns for one customer row aliased c: disbursed loans, worst days past due, and any write-off.
export const gradeColumns=`(SELECT COUNT(*) FROM applications g WHERE g.customer_id=c.id AND g.status IN ('active','paid_off','closed','written_off'))::int AS grade_loans,
  COALESCE((SELECT MAX(g.max_dpd) FROM applications g WHERE g.customer_id=c.id AND g.status IN ('active','paid_off','closed','written_off')),0)::int AS grade_worst_dpd,
  EXISTS(SELECT 1 FROM applications g WHERE g.customer_id=c.id AND g.status='written_off') AS grade_written_off`;
