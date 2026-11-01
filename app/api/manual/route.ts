import {NextResponse} from 'next/server';
import {z} from 'zod';
import {currentActor} from '@/lib/auth';
import {addCharge,createQuickLoan,importLoan} from '@/lib/manual';

const borrower={name:z.string().trim().min(1).max(200),phone:z.string().min(8).max(20),nik:z.string().regex(/^\d{16}$/).nullable(),branchId:z.string().max(40).nullable(),collectorId:z.string().max(40)};
const schema=z.discriminatedUnion('type',[
  z.object({type:z.literal('quick'),...borrower,principal:z.number().int(),weeks:z.number().int()}),
  z.object({type:z.literal('import'),...borrower,principal:z.number().int(),weeks:z.number().int(),interest:z.number().int(),disbursedOn:z.string().max(10),paid:z.number().int()}),
  z.object({type:z.literal('charge'),applicationId:z.uuid(),kind:z.string().max(40),amount:z.number().int(),reason:z.string().max(300)})
]);
const messages:Record<string,string>={Forbidden:'Peran Anda tidak dapat melakukan ini','Invalid borrower details':'Periksa nama, nomor HP (8-20 digit), dan NIK (16 digit bila diisi)',
  'Collector required':'Pilih petugas penagih dari cabang tersebut','Customer registered in another branch':'NIK ini terdaftar di cabang lain',
  'Customer has an open loan':'Nasabah masih memiliki pinjaman berjalan','No active policy':'Belum ada kebijakan aktif','Outside policy limits':'Jumlah atau tenor di luar kebijakan',
  'Above borrowing limit':'Jumlah melebihi batas pinjaman nasabah ini','Officer exposure limit reached':'Batas pokok beredar petugas ini akan terlampaui',
  'Branch exposure limit reached':'Batas pokok beredar cabang akan terlampaui','Invalid import':'Periksa jumlah, tenor (1-104 minggu), tanggal cair (paling lama 2 tahun lalu), dan jumlah yang sudah dibayar',
  'Imported loan already paid':'Pinjaman ini sudah lunas, tidak perlu dimasukkan','Invalid charge':'Periksa jenis, jumlah (tidak lebih dari pokok), dan alasan',
  'Loan is not active':'Pinjaman belum aktif','Application not found':'Pinjaman tidak ditemukan','Unrelated application':'Pinjaman ini di luar cakupan Anda'};

export async function POST(request:Request){
  const origin=request.headers.get('origin');
  if(origin&&new URL(origin).host!==request.headers.get('host'))return NextResponse.json({error:'Permintaan dari asal berbeda ditolak'},{status:403});
  const actor=await currentActor();
  if(!actor)return NextResponse.json({error:'Silakan masuk terlebih dahulu'},{status:401});
  try{
    const input=schema.parse(await request.json());
    if(input.type==='quick')return NextResponse.json(await createQuickLoan(actor,input),{status:201});
    if(input.type==='import')return NextResponse.json(await importLoan(actor,input),{status:201});
    return NextResponse.json(await addCharge(actor,input.applicationId,input.kind,input.amount,input.reason),{status:201});
  }catch(error){
    const message=error instanceof Error?error.message:'';
    return NextResponse.json({error:error instanceof z.ZodError?'Periksa kembali isian formulir':messages[message]??'Gagal disimpan. Coba lagi.'},{status:message==='Forbidden'?403:400});
  }
}
