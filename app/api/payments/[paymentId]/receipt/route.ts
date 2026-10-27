import {currentActor} from '@/lib/auth';
import {readPaymentReceipt} from '@/lib/workflow';

export async function GET(_request:Request,{params}:{params:Promise<{paymentId:string}>}){
  const actor=await currentActor();
  if(!actor)return Response.json({error:'Silakan masuk terlebih dahulu'},{status:401});
  const {paymentId}=await params;
  if(!/^[0-9a-f-]{36}$/i.test(paymentId))return Response.json({error:'Bukti tidak ditemukan'},{status:404});
  try{
    const receipt=await readPaymentReceipt(actor,paymentId);
    return new Response(new Uint8Array(receipt.data),{headers:{'Content-Type':receipt.mime,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Disposition':'inline'}});
  }catch{return Response.json({error:'Bukti tidak tersedia untuk peran Anda'},{status:403});}
}
