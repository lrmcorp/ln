import {NextResponse} from 'next/server';
import {z} from 'zod';
import {currentActor} from '@/lib/auth';
import {readReceiptForPayment} from '@/lib/workflow';

export async function POST(request:Request){
  const origin=request.headers.get('origin');
  if(origin&&new URL(origin).host!==request.headers.get('host'))return NextResponse.json({error:'Permintaan dari asal berbeda ditolak'},{status:403});
  const actor=await currentActor();
  if(!actor)return NextResponse.json({error:'Silakan masuk terlebih dahulu'},{status:401});
  try{
    const form=await request.formData();
    const receipt=form.get('receipt');
    if(!(receipt instanceof File)||receipt.size>5*1024*1024)throw new Error('Invalid receipt');
    const applicationId=z.uuid().parse(form.get('applicationId'));
    const read=await readReceiptForPayment(actor,applicationId,new Uint8Array(await receipt.arrayBuffer()));
    return NextResponse.json(read??{amount:null});
  }catch(error){
    const message=error instanceof Error?error.message:'';
    const forbidden=['Forbidden','Unassigned application','Unrelated application'].includes(message);
    if(!forbidden&&message!=='Invalid receipt')console.error('Receipt read failed',error);
    return NextResponse.json({error:forbidden?'Pinjaman ini bukan tanggung jawab Anda':message==='Invalid receipt'?'Unggah bukti pembayaran JPG, PNG, atau PDF maksimal 5 MB':'Bukti belum dapat dibaca'},{status:forbidden?403:400});
  }
}
