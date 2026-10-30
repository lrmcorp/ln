import {currentActor} from '@/lib/auth';
import {readDepositProof} from '@/lib/payments';

export async function GET(_request:Request,{params}:{params:Promise<{depositId:string}>}){
  const actor=await currentActor();
  if(!actor)return Response.json({error:'Silakan masuk terlebih dahulu'},{status:401});
  const {depositId}=await params;
  if(!/^[0-9a-f-]{36}$/i.test(depositId))return Response.json({error:'Bukti tidak ditemukan'},{status:404});
  try{
    const proof=await readDepositProof(actor,depositId);
    return new Response(new Uint8Array(proof.data),{headers:{'Content-Type':proof.mime,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Disposition':'inline'}});
  }catch{return Response.json({error:'Bukti tidak tersedia untuk peran Anda'},{status:403});}
}
