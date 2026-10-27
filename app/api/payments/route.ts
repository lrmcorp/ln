import {NextResponse} from 'next/server';
import {z} from 'zod';
import {currentActor} from '@/lib/auth';
import {recordPayment} from '@/lib/workflow';

const fields=z.object({applicationId:z.uuid(),amount:z.number().int().positive(),reference:z.string().trim().max(100)});

export async function POST(request:Request){
  const origin=request.headers.get('origin');
  if(origin&&new URL(origin).host!==request.headers.get('host'))return NextResponse.json({error:'Permintaan dari asal berbeda ditolak'},{status:403});
  const actor=await currentActor();
  if(!actor)return NextResponse.json({error:'Silakan masuk terlebih dahulu'},{status:401});
  if(actor.role!=='owner'&&actor.role!=='manager')return NextResponse.json({error:'Hanya manajer cabang atau pemilik yang dapat mencatat pembayaran'},{status:403});
  try{
    const form=await request.formData();
    const receipt=form.get('receipt');
    if(!(receipt instanceof File)||receipt.size>5*1024*1024)throw new Error('Invalid receipt');
    const input=fields.parse({applicationId:form.get('applicationId'),amount:Number(form.get('amount')),reference:form.get('reference')??''});
    const result=await recordPayment(actor,input.applicationId,input.amount,input.reference||null,new Uint8Array(await receipt.arrayBuffer()));
    return NextResponse.json(result,{status:201});
  }catch(error){
    const message=error instanceof Error?error.message:'';
    const conflict=/duplicate key|unique constraint/i.test(message);
    const known:Record<string,string>={Forbidden:'Pinjaman ini berada di luar cabang Anda','Application not found':'Pinjaman tidak ditemukan',
      'Loan is not active':'Pembayaran hanya dapat dicatat untuk pinjaman aktif','Invalid payment':'Jumlah atau nomor referensi tidak valid',
      'Overpayment requires review':'Jumlah melebihi sisa tagihan','Invalid receipt':'Unggah bukti pembayaran JPG, PNG, atau PDF maksimal 5 MB'};
    return NextResponse.json({error:conflict?'Bukti atau nomor referensi ini sudah pernah dicatat':error instanceof z.ZodError?'Periksa jumlah pembayaran':known[message]??'Pembayaran gagal dicatat'},{status:conflict?409:400});
  }
}
