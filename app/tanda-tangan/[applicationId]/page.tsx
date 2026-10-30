import {redirect} from 'next/navigation';
import {currentActor} from '@/lib/auth';
import {signingPreview} from '@/lib/intake';
import SigningScreen from '@/app/ui/SigningScreen';

export const dynamic='force-dynamic';
export default async function SignaturePage({params}:{params:Promise<{applicationId:string}>}){
  const {applicationId}=await params;
  const actor=await currentActor();
  if(!actor)redirect(`/?lanjut=${encodeURIComponent(`/tanda-tangan/${applicationId}`)}`);
  if(actor.role==='owner')redirect('/');
  try{
    const preview=await signingPreview(actor,applicationId);
    return <SigningScreen role={actor.role==='customer'?'customer':'officer'} preview={preview}/>;
  }catch{return <main className="signingPage"><div className="signingShell"><h1>Tanda tangan tidak tersedia</h1><p>Pengajuan ini mungkin sudah ditandatangani atau bukan milik Anda.</p><a href="/">Kembali ke ruang kerja</a></div></main>;}
}
