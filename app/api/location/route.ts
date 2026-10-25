import {NextResponse} from 'next/server';
import {z} from 'zod';
import {currentActor} from '@/lib/auth';
import {customerLocation,monitorLocations,reportLocation,setLocationConsent} from '@/lib/location';

const action=z.discriminatedUnion('type',[
  z.object({type:z.literal('consent'),enabled:z.boolean()}),
  z.object({type:z.literal('report'),latitude:z.number(),longitude:z.number(),accuracy:z.number()})
]);
const messages:Record<string,string>={
  Forbidden:'Anda tidak memiliki izin untuk melihat lokasi',
  'Active loan required for location sharing':'Berbagi lokasi hanya tersedia selama pinjaman aktif',
  'Location consent required':'Izin berbagi lokasi belum diberikan',
  'Invalid location report':'Data lokasi tidak valid'
};
const respond=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});

export async function GET(){
  const actor=await currentActor();
  if(!actor) return respond({error:'Silakan masuk terlebih dahulu'},401);
  try{
    return respond(actor.role==='customer'?await customerLocation(actor):await monitorLocations(actor));
  }catch(error){
    const message=error instanceof Error?error.message:'';
    return respond({error:messages[message]??'Gagal mengambil status lokasi'},403);
  }
}

export async function POST(request:Request){
  const origin=request.headers.get('origin');
  if(origin && new URL(origin).host!==request.headers.get('host')) return respond({error:'Permintaan dari asal berbeda ditolak'},403);
  const actor=await currentActor();
  if(!actor) return respond({error:'Silakan masuk terlebih dahulu'},401);
  if(actor.role!=='customer') return respond({error:'Hanya nasabah yang dapat mengubah izin lokasi'},403);
  try{
    const body=action.parse(await request.json());
    return respond(body.type==='consent'?await setLocationConsent(actor,body.enabled):await reportLocation(actor,body.latitude,body.longitude,body.accuracy));
  }catch(error){
    const message=error instanceof Error?error.message:'';
    return respond({error:error instanceof z.ZodError?'Data lokasi tidak valid':messages[message]??'Permintaan lokasi gagal'},400);
  }
}
