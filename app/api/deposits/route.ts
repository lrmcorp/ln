import {NextResponse} from 'next/server';
import {currentActor} from '@/lib/auth';
import {submitDeposit} from '@/lib/payments';

export async function POST(request:Request){
  const origin=request.headers.get('origin');
  if(origin&&new URL(origin).host!==request.headers.get('host'))return NextResponse.json({error:'Permintaan dari asal berbeda ditolak'},{status:403});
  const actor=await currentActor();
  if(!actor)return NextResponse.json({error:'Silakan masuk terlebih dahulu'},{status:401});
  try{
    const form=await request.formData();
    const proof=form.get('proof');
    if(!(proof instanceof File)||proof.size>5*1024*1024)throw new Error('Invalid receipt');
    const result=await submitDeposit(actor,String(form.get('date')??''),Number(form.get('amount')),new Uint8Array(await proof.arrayBuffer()));
    return NextResponse.json(result,{status:201});
  }catch(error){
    const message=error instanceof Error?error.message:'';
    const conflict=/duplicate key|unique constraint/i.test(message);
    const known:Record<string,string>={Forbidden:'Hanya petugas lapangan yang menyetor kas','Invalid deposit':'Tanggal atau jumlah setoran tidak valid',
      'Invalid receipt':'Unggah bukti setoran JPG, PNG, atau PDF maksimal 5 MB','Nothing left to deposit':'Tidak ada tunai yang perlu disetor untuk tanggal ini'};
    return NextResponse.json({error:conflict?'Bukti ini sudah pernah dipakai':known[message]??'Setoran gagal dikirim'},{status:conflict?409:400});
  }
}
