import {NextResponse} from 'next/server';
import {pool} from '@/lib/db';
import {createSession,verifyPassword} from '@/lib/auth';

export async function POST(request:Request){
  try {
    const body=await request.json();
    if(typeof body.email!=='string'||typeof body.password!=='string') throw new Error('Email dan kata sandi wajib diisi');
    const result=await pool.query('SELECT id,password_hash FROM users WHERE email=$1',[body.email.toLowerCase().trim()]);
    const user=result.rows[0];
    if(!user||!verifyPassword(body.password,user.password_hash)) return NextResponse.json({error:'Email atau kata sandi salah'},{status:401});
    const response=NextResponse.json({ok:true});
    response.cookies.set('ln_session',createSession(user.id),{httpOnly:true,sameSite:'strict',secure:process.env.NODE_ENV==='production',path:'/',maxAge:8*60*60});
    return response;
  } catch {return NextResponse.json({error:'Permintaan masuk tidak valid'},{status:400});}
}
