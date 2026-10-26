import {NextResponse} from 'next/server';
import {z} from 'zod';
import {activateMobileDevice} from '@/lib/mobile-location';

const input=z.object({code:z.string().length(24)});
export async function POST(request:Request){
  try{
    const {code}=input.parse(await request.json());
    return NextResponse.json(await activateMobileDevice(code),{headers:{'Cache-Control':'no-store'}});
  }catch{
    return NextResponse.json({error:'Kode pemasangan tidak valid, kedaluwarsa, atau pinjaman belum aktif'},{status:400,headers:{'Cache-Control':'no-store'}});
  }
}
