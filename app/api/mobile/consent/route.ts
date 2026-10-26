import {NextResponse} from 'next/server';
import {z} from 'zod';
import {mobileBearer,setMobileConsent} from '@/lib/mobile-location';

const input=z.object({enabled:z.boolean()});
export async function POST(request:Request){
  try{
    const {enabled}=input.parse(await request.json());
    return NextResponse.json(await setMobileConsent(mobileBearer(request),enabled),{headers:{'Cache-Control':'no-store'}});
  }catch(error){
    const message=error instanceof Error?error.message:'';
    return NextResponse.json({error:message==='Active loan required'?'Pinjaman belum aktif':'Perangkat atau izin lokasi tidak valid'},{status:400,headers:{'Cache-Control':'no-store'}});
  }
}
