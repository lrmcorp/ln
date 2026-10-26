import {NextResponse} from 'next/server';
import {mobileBearer,mobileDeviceStatus} from '@/lib/mobile-location';

export async function GET(request:Request){
  try{
    return NextResponse.json(await mobileDeviceStatus(mobileBearer(request)),{headers:{'Cache-Control':'no-store'}});
  }catch{return NextResponse.json({error:'Perangkat tidak terdaftar'},{status:401,headers:{'Cache-Control':'no-store'}});}
}
