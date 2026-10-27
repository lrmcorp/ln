import {NextResponse} from 'next/server';
import {z} from 'zod';
import {currentActor} from '@/lib/auth';
import {signApplication} from '@/lib/intake';

const schema=z.object({applicationId:z.uuid(),signerName:z.string().min(1).max(200),accepted:z.literal(true),
  termsHash:z.string().regex(/^[0-9a-f]{64}$/),signatureDataUrl:z.string().startsWith('data:image/png;base64,').max(700000)});

export async function POST(request:Request){
  const origin=request.headers.get('origin');
  if(origin&&new URL(origin).host!==request.headers.get('host'))return NextResponse.json({error:'Permintaan dari asal berbeda ditolak'},{status:403});
  const actor=await currentActor();
  if(!actor)return NextResponse.json({error:'Silakan masuk terlebih dahulu'},{status:401});
  if(actor.role!=='officer'&&actor.role!=='customer')return NextResponse.json({error:'Peran Anda tidak dapat menandatangani'},{status:403});
  try{
    const body=schema.parse(await request.json());
    const signature=Buffer.from(body.signatureDataUrl.slice('data:image/png;base64,'.length),'base64');
    const result=await signApplication(actor,body.applicationId,body.signerName,body.accepted,body.termsHash,signature);
    return NextResponse.json(result);
  }catch(error){
    const message=error instanceof Error?error.message:'';
    const known:Record<string,string>={Forbidden:'Pengajuan ini tidak dapat Anda tandatangani',
      'Signing is not available':'Pengajuan ini tidak menunggu tanda tangan',
      'Signer name does not match borrower':'Nama penandatangan harus sesuai nama nasabah',
      'Terms changed; review again':'Syarat telah berubah. Muat ulang dan baca kembali sebelum menandatangani',
      'Invalid signature image':'Tanda tangan tidak valid. Gambar ulang di kotak tanda tangan',
      'Terms acceptance required':'Nasabah harus menyetujui syarat secara sadar',
      'A verified signature provider is required':'Layanan tanda tangan terverifikasi diperlukan'};
    return NextResponse.json({error:error instanceof z.ZodError?'Periksa nama, persetujuan, dan tanda tangan':known[message]??'Tanda tangan gagal disimpan'},{status:400});
  }
}
