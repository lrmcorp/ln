import {NextResponse} from 'next/server';
import {z} from 'zod';
import {currentActor} from '@/lib/auth';
import {borrowerLookup} from '@/lib/intake';

const body=z.object({nik:z.string().regex(/^\d{16}$/),name:z.string().max(200)});
const messages:Record<string,string>={'Customer registered in another branch':'NIK ini terdaftar di cabang lain',
  'Name does not match registered NIK':'Nama tidak sama dengan data NIK yang terdaftar','Customer has an open loan':'Nasabah masih memiliki pinjaman berjalan',
  'No active policy':'Belum ada kebijakan aktif',Forbidden:'Hanya petugas lapangan yang dapat memeriksa nasabah'};

export async function POST(request:Request){
  const origin=request.headers.get('origin');
  if(origin&&new URL(origin).host!==request.headers.get('host'))return NextResponse.json({error:'Permintaan dari asal berbeda ditolak'},{status:403});
  const actor=await currentActor();
  if(!actor)return NextResponse.json({error:'Silakan masuk terlebih dahulu'},{status:401});
  try{
    const input=body.parse(await request.json());
    return NextResponse.json(await borrowerLookup(actor,input.nik,input.name));
  }catch(error){
    const message=error instanceof Error?error.message:'';
    return NextResponse.json({error:error instanceof z.ZodError?'NIK harus 16 digit':messages[message]??'Data nasabah belum dapat diperiksa'},{status:400});
  }
}
