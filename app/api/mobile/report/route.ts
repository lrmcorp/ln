import {NextResponse} from 'next/server';
import {z} from 'zod';
import {mobileBearer,reportMobileLocation} from '@/lib/mobile-location';

const input=z.object({latitude:z.number(),longitude:z.number(),accuracy:z.number()});
export async function POST(request:Request){
  try{
    const data=input.parse(await request.json());
    return NextResponse.json(await reportMobileLocation(mobileBearer(request),data.latitude,data.longitude,data.accuracy),{headers:{'Cache-Control':'no-store'}});
  }catch(error){
    const message=error instanceof Error?error.message:'';
    return NextResponse.json({error:message==='Active loan required'?'Pinjaman tidak aktif':message==='Location consent required'?'Izin lokasi tidak aktif':'Laporan lokasi ditolak'},
      {status:message==='Active loan required'?409:400,headers:{'Cache-Control':'no-store'}});
  }
}
