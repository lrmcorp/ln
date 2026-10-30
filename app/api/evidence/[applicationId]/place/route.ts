import {currentActor} from '@/lib/auth';
import {readPlacePhoto} from '@/lib/evidence';

export async function GET(_request:Request,{params}:{params:Promise<{applicationId:string}>}){
  const actor=await currentActor();
  if(!actor)return Response.json({error:'Silakan masuk terlebih dahulu'},{status:401});
  const {applicationId}=await params;
  if(!/^[0-9a-f-]{36}$/i.test(applicationId))return Response.json({error:'Foto tidak ditemukan'},{status:404});
  try{
    const photo=await readPlacePhoto(actor,applicationId);
    return new Response(new Uint8Array(photo.data),{headers:{'Content-Type':photo.mime,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Disposition':'inline'}});
  }catch{return Response.json({error:'Foto lokasi tidak tersedia'},{status:404});}
}
