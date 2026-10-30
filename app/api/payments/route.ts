import {NextResponse} from 'next/server';
import {z} from 'zod';
import {currentActor} from '@/lib/auth';
import {recordPayment} from '@/lib/payments';

const fields=z.object({applicationId:z.uuid(),amount:z.number().int().positive().nullable(),reference:z.string().trim().max(100),
  amountSource:z.enum(['entered','read_confirmed']),method:z.enum(['transfer','cash']),earlyPayoff:z.boolean()});

export async function POST(request:Request){
  const origin=request.headers.get('origin');
  if(origin&&new URL(origin).host!==request.headers.get('host'))return NextResponse.json({error:'Permintaan dari asal berbeda ditolak'},{status:403});
  const actor=await currentActor();
  if(!actor)return NextResponse.json({error:'Silakan masuk terlebih dahulu'},{status:401});
  if(actor.role==='customer')return NextResponse.json({error:'Peran Anda tidak dapat mencatat pembayaran'},{status:403});
  try{
    const form=await request.formData();
    const receipt=form.get('receipt');
    if(!(receipt instanceof File)||receipt.size>5*1024*1024)throw new Error('Invalid receipt');
    const rawAmount=String(form.get('amount')??'').trim();
    const input=fields.parse({applicationId:form.get('applicationId'),amount:rawAmount?Number(rawAmount):null,reference:form.get('reference')??'',
      amountSource:form.get('amountSource')==='read_confirmed'?'read_confirmed':'entered',method:form.get('method')==='cash'?'cash':'transfer',earlyPayoff:form.get('earlyPayoff')==='1'});
    const result=await recordPayment(actor,input.applicationId,input.amount,new Uint8Array(await receipt.arrayBuffer()),
      {reference:input.reference||null,source:input.amountSource,method:input.method,earlyPayoff:input.earlyPayoff});
    return NextResponse.json(result,{status:201});
  }catch(error){
    const message=error instanceof Error?error.message:'';
    const conflict=/duplicate key|unique constraint/i.test(message);
    const known:Record<string,string>={Forbidden:'Pinjaman ini bukan tanggung jawab Anda','Unassigned application':'Pinjaman ini tidak ditugaskan kepada Anda',
      'Application not found':'Pinjaman tidak ditemukan','Loan is not active':'Pembayaran hanya dapat dicatat untuk pinjaman aktif',
      'Invalid payment':'Nominal atau nomor referensi tidak valid','Overpayment requires review':'Nominal melebihi sisa tagihan',
      'Invalid receipt':'Unggah bukti pembayaran JPG, PNG, atau PDF maksimal 5 MB',
      'Receipt amount unreadable':'Nominal tidak terbaca dari bukti. Isi nominal secara manual.',
      'Early payoff amount mismatch':'Nominal pelunasan dipercepat harus sama dengan jumlah yang ditampilkan. Muat ulang halaman.'};
    return NextResponse.json({error:conflict?'Bukti atau nomor referensi ini sudah pernah dicatat':error instanceof z.ZodError?'Periksa nominal pembayaran':known[message]??'Pembayaran gagal dicatat'},{status:conflict?409:400});
  }
}
