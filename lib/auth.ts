import {createHmac, randomBytes, scryptSync, timingSafeEqual} from 'node:crypto';
import {cookies} from 'next/headers';
import {pool} from './db';

export type Actor={id:string;name:string;email:string;role:'owner'|'manager'|'officer'|'customer';branch_id:string|null;customer_id:string|null};
const secret=process.env.SESSION_SECRET;
if (!secret || secret.length<32) throw new Error('SESSION_SECRET must be at least 32 characters');
export function hashPassword(password:string, salt=randomBytes(16).toString('hex')) {
  return `${salt}:${scryptSync(password,salt,64).toString('hex')}`;
}
export function verifyPassword(password:string, stored:string) {
  const [salt,hash]=stored.split(':');
  if (!salt||!hash) return false;
  const actual=scryptSync(password,salt,64);
  const expected=Buffer.from(hash,'hex');
  return expected.length===actual.length && timingSafeEqual(actual,expected);
}
function signature(value:string){return createHmac('sha256',secret!).update(value).digest('hex');}
export function createSession(id:string){
  const expiry=Date.now()+8*60*60*1000;
  const value=`${id}.${expiry}`;
  return `${value}.${signature(value)}`;
}
export function parseSession(token:string|undefined){
  if (!token) return null;
  const parts=token.split('.');
  if(parts.length!==3) return null;
  const [id,expiry,mac]=parts;
  if(!/^[0-9a-f-]{36}$/.test(id)||!/^\d+$/.test(expiry)||Number(expiry)<Date.now()) return null;
  const actual=Buffer.from(mac,'hex'), expected=Buffer.from(signature(`${id}.${expiry}`),'hex');
  return actual.length===expected.length && timingSafeEqual(actual,expected)?id:null;
}
export async function currentActor():Promise<Actor|null>{
  const id=parseSession((await cookies()).get('ln_session')?.value);
  if(!id)return null;
  const result=await pool.query<Actor>('SELECT id,name,email,role,branch_id,customer_id FROM users WHERE id=$1',[id]);
  return result.rows[0]??null;
}
export function requireRole(actor:Actor|null,roles:Actor['role'][]):asserts actor is Actor {
  if(!actor || !roles.includes(actor.role)) throw new Error('Forbidden');
}
