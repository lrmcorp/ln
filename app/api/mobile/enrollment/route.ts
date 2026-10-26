import {NextResponse} from 'next/server';
import {z} from 'zod';
import {currentActor} from '@/lib/auth';
import {createMobileEnrollment} from '@/lib/mobile-location';

const input=z.object({applicationId:z.uuid()});
export async function POST(request:Request){
  const origin=request.headers.get('origin');
  if(origin&&new URL(origin).host!==request.headers.get('host'))return NextResponse.json({error:'Asal permintaan ditolak'},{status:403});
  const actor=await currentActor();
  if(!actor)return NextResponse.json({error:'Silakan masuk terlebih dahulu'},{status:401});
  try{
    const {applicationId}=input.parse(await request.json());
    return NextResponse.json(await createMobileEnrollment(actor,applicationId),{headers:{'Cache-Control':'no-store'}});
  }catch(error){
    const message=error instanceof Error?error.message:'';
    return NextResponse.json({error:message==='Active loan required'?'Pinjaman harus aktif sebelum kode APK dibuat':message==='Forbidden'?'Pengajuan tidak tersedia untuk Anda':'Gagal membuat kode APK'},{status:400});
  }
}
