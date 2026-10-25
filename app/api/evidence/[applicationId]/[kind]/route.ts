import {currentActor} from '@/lib/auth';
import {readIntakeEvidence} from '@/lib/evidence';

export async function GET(_request:Request,{params}:{params:Promise<{applicationId:string;kind:string}>}){
  const actor=await currentActor();
  if(!actor)return Response.json({error:'Silakan masuk terlebih dahulu'},{status:401});
  const {applicationId,kind}=await params;
  if(!/^[0-9a-f-]{36}$/i.test(applicationId)||!['ktp','liveness'].includes(kind))return Response.json({error:'Bukti tidak ditemukan'},{status:404});
  try{
    const evidence=await readIntakeEvidence(actor,applicationId,kind as 'ktp'|'liveness');
    return new Response(new Uint8Array(evidence.data),{headers:{'Content-Type':evidence.mime,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Disposition':'inline'}});
  }catch{return Response.json({error:'Bukti tidak tersedia untuk peran Anda'},{status:403});}
}
