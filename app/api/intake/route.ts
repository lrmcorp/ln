import {NextResponse} from 'next/server';
import {z} from 'zod';
import {currentActor} from '@/lib/auth';
import {createIntake} from '@/lib/intake';

const details=z.object({
  name:z.string().trim().min(1).max(200),nik:z.string().regex(/^\d{16}$/),dateOfBirth:z.iso.date(),
  phone:z.string().min(8).max(20),address:z.string().trim().min(1).max(500),motherName:z.string().trim().min(1).max(200),
  bankName:z.string().trim().min(1).max(100),bankAccountNumber:z.string().regex(/^\d{5,30}$/),accountHolder:z.string().trim().min(1).max(200),
  occupation:z.string().max(200),loanPurpose:z.string().max(300),principal:z.number().int().positive(),weeks:z.number().int().positive(),weeklyIncome:z.number().int().positive(),collectorId:z.string().max(40).nullable()
});

export async function POST(request:Request){
  const origin=request.headers.get('origin');
  if(origin&&new URL(origin).host!==request.headers.get('host'))return NextResponse.json({error:'Permintaan dari asal berbeda ditolak'},{status:403});
  const actor=await currentActor();
  if(!actor)return NextResponse.json({error:'Silakan masuk terlebih dahulu'},{status:401});
  if(actor.role!=='officer'&&actor.role!=='manager')return NextResponse.json({error:'Hanya petugas lapangan atau manajer cabang yang dapat membuat pengajuan'},{status:403});
  try{
    const form=await request.formData();
    const ktp=form.get('ktp'),liveness=form.get('liveness');
    if(!(ktp instanceof File)||!(liveness instanceof File)||ktp.size>4*1024*1024||liveness.size>12*1024*1024)throw new Error('Invalid evidence files');
    const input=details.parse({name:form.get('name'),nik:form.get('nik'),dateOfBirth:form.get('dateOfBirth'),phone:form.get('phone'),
      address:form.get('address'),motherName:form.get('motherName'),bankName:form.get('bankName'),bankAccountNumber:form.get('bankAccountNumber'),
      accountHolder:form.get('accountHolder'),occupation:form.get('occupation')??'',loanPurpose:form.get('loanPurpose')??'',
      principal:Number(form.get('principal')),weeks:Number(form.get('weeks')),weeklyIncome:Number(form.get('weeklyIncome')),collectorId:(form.get('collectorId') as string|null)||null});
    const result=await createIntake(actor,input,new Uint8Array(await ktp.arrayBuffer()),new Uint8Array(await liveness.arrayBuffer()));
    return NextResponse.json(result,{status:201});
  }catch(error){
    const message=error instanceof Error?error.message:'';
    const conflict=/duplicate key|unique constraint/i.test(message);
    const known:Record<string,string>={'Invalid borrower details':'Data nasabah belum lengkap atau tidak valid','No active policy':'Belum ada kebijakan aktif',
      'Outside policy limits':'Jumlah atau tenor di luar kebijakan','Invalid KTP photo size':'Ukuran foto KTP tidak valid',
      'Invalid liveness video size':'Ukuran video tantangan tidak valid','Unsupported evidence format':'Gunakan JPG/PNG untuk KTP dan MP4/WebM untuk video',
      'Invalid evidence files':'Foto KTP dan video tantangan wajib diunggah dalam batas ukuran',
      'Customer registered in another branch':'NIK ini terdaftar di cabang lain','Name does not match registered NIK':'Nama tidak sama dengan data NIK yang terdaftar',
      'Customer has an open loan':'Nasabah masih memiliki pinjaman berjalan','Above borrowing limit':'Jumlah melebihi batas pinjaman nasabah ini',
      'Installment exceeds income share':'Cicilan mingguan melebihi batas porsi pendapatan nasabah','Collector required':'Pilih petugas penagih dari cabang Anda',
      'Officer exposure limit reached':'Batas pokok beredar petugas ini akan terlampaui','Branch exposure limit reached':'Batas pokok beredar cabang akan terlampaui'};
    return NextResponse.json({error:conflict?'NIK sudah terdaftar':error instanceof z.ZodError?'Periksa kembali data pengajuan':known[message]??'Pengajuan gagal disimpan'},{status:conflict?409:400});
  }
}
