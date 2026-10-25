import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';

const keyText=process.env.DATA_ENCRYPTION_KEY;
const key=keyText?Buffer.from(keyText,'base64url'):Buffer.alloc(0);
if(key.length!==32) throw new Error('DATA_ENCRYPTION_KEY must be a 32-byte base64url key');

export function protect(data:Uint8Array){
  const iv=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',key,iv);
  const encrypted=Buffer.concat([cipher.update(data),cipher.final()]);
  return {cipher:encrypted,iv,tag:cipher.getAuthTag(),sha256:createHash('sha256').update(data).digest('hex')};
}

export function reveal(ciphertext:Uint8Array,iv:Uint8Array,tag:Uint8Array){
  const decipher=createDecipheriv('aes-256-gcm',key,iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext),decipher.final()]);
}

export function imageMime(data:Uint8Array){
  if(data.length>=3&&data[0]===0xff&&data[1]===0xd8&&data[2]===0xff)return 'image/jpeg';
  if(data.length>=8&&Buffer.from(data.subarray(0,8)).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
  return null;
}

export function videoMime(data:Uint8Array){
  if(data.length>=4&&Buffer.from(data.subarray(0,4)).equals(Buffer.from([26,69,223,163])))return 'video/webm';
  if(data.length>=8&&Buffer.from(data.subarray(4,8)).toString('ascii')==='ftyp')return 'video/mp4';
  return null;
}
