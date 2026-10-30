import {NextResponse} from 'next/server';
import {pool} from '@/lib/db';
import {createSession,verifyPassword} from '@/lib/auth';

export async function POST(request:Request){
  try {
    const body=await request.json();
    // Accepts a username or an email; older clients still send `email`.
    const login=typeof body.login==='string'?body.login:body.email;
    if(typeof login!=='string'||typeof body.password!=='string') throw new Error('Nama pengguna dan kata sandi wajib diisi');
    const id=login.toLowerCase().trim();
    const result=await pool.query('SELECT id,password_hash FROM users WHERE (email=$1 OR lower(username)=$1) AND active LIMIT 1',[id]);
    const user=result.rows[0];
    if(!user||!verifyPassword(body.password,user.password_hash)) return NextResponse.json({error:'Nama pengguna atau kata sandi salah'},{status:401});
    const response=NextResponse.json({ok:true});
    response.cookies.set('ln_session',createSession(user.id),{httpOnly:true,sameSite:'strict',secure:process.env.NODE_ENV==='production',path:'/',maxAge:8*60*60});
    return response;
  } catch {return NextResponse.json({error:'Permintaan masuk tidak valid'},{status:400});}
}
