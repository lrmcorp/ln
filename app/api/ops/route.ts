import {NextResponse} from 'next/server';
import {z} from 'zod';
import {currentActor} from '@/lib/auth';
import {rejectPayment,reviewDeposit,verifyPayment} from '@/lib/payments';
import {assignCollector,logVisit} from '@/lib/collections';
import {proposeRestructure,writeOff} from '@/lib/accounting';
import {createBranch,createUser,recordCapital,updateUser} from '@/lib/admin';

const uuid=z.uuid();
const schema=z.discriminatedUnion('type',[
  z.object({type:z.literal('verify_payment'),paymentId:uuid,note:z.string().max(500).optional()}),
  z.object({type:z.literal('reject_payment'),paymentId:uuid,note:z.string().max(500)}),
  z.object({type:z.literal('review_deposit'),depositId:uuid,approve:z.boolean(),note:z.string().max(500).optional()}),
  z.object({type:z.literal('log_visit'),applicationId:uuid,outcome:z.string(),promiseDate:z.string().nullable(),note:z.string().max(500)}),
  z.object({type:z.literal('assign_collector'),applicationId:uuid,collectorId:uuid}),
  z.object({type:z.literal('write_off'),applicationId:uuid,reason:z.string().max(500)}),
  z.object({type:z.literal('propose_restructure'),applicationId:uuid,weeks:z.number().int(),reason:z.string().max(500)}),
  z.object({type:z.literal('create_branch'),name:z.string().max(100)}),
  z.object({type:z.literal('create_user'),username:z.string().max(40),name:z.string().max(200),role:z.string(),branchId:uuid,password:z.string().max(200)}),
  z.object({type:z.literal('update_user'),userId:uuid,password:z.string().max(200).optional(),active:z.boolean().optional(),branchId:uuid.optional()}),
  z.object({type:z.literal('record_capital'),kind:z.enum(['injection','withdrawal','distribution']),source:z.string().max(100),sourceType:z.enum(['owner','investor']),
    amount:z.number().int(),annualCostBps:z.number().int(),date:z.string(),note:z.string().max(500)})
]);

const messages:Record<string,string>={
  Forbidden:'Anda tidak memiliki izin untuk tindakan ini','Application not found':'Pinjaman tidak ditemukan','Payment not found':'Pembayaran tidak ditemukan',
  'Payment already reviewed':'Pembayaran ini sudah ditinjau','Recorder cannot verify own payment':'Pencatat tidak boleh memverifikasi pembayarannya sendiri',
  'Reason required':'Alasan wajib diisi','Loan already closed':'Pinjaman sudah ditutup','Deposit not found':'Setoran tidak ditemukan',
  'Deposit already reviewed':'Setoran ini sudah ditinjau','Invalid visit':'Data kunjungan tidak valid','Promise date must be within 14 days':'Tanggal janji bayar harus dalam 14 hari ke depan',
  'Loan is not active':'Pinjaman tidak aktif','Collector must be an active officer in the loan branch':'Penagih harus petugas aktif di cabang pinjaman ini',
  'Write-off requires 30 days past due':'Hapus buku hanya untuk pinjaman terlambat minimal 30 hari','Invalid restructure':'Tenor restrukturisasi 1 sampai 52 minggu',
  'Nothing left to restructure':'Tidak ada sisa kewajiban untuk direstrukturisasi','Invalid branch':'Nama cabang tidak valid',
  'Invalid user':'Data pengguna tidak valid. Nama pengguna 3-40 huruf kecil/angka, kata sandi minimal 8 karakter','Cannot deactivate yourself':'Anda tidak dapat menonaktifkan akun sendiri',
  'Invalid capital movement':'Data modal tidak valid','Not enough cash':'Kas tidak cukup untuk penarikan ini'
};

export async function POST(request:Request){
  try{
    const origin=request.headers.get('origin');
    if(origin&&new URL(origin).host!==request.headers.get('host'))return NextResponse.json({error:'Permintaan dari asal berbeda ditolak'},{status:403});
    const actor=await currentActor();
    if(!actor)return NextResponse.json({error:'Silakan masuk terlebih dahulu'},{status:401});
    const op=schema.parse(await request.json());
    switch(op.type){
      case 'verify_payment':return NextResponse.json(await verifyPayment(actor,op.paymentId,op.note??''));
      case 'reject_payment':return NextResponse.json(await rejectPayment(actor,op.paymentId,op.note));
      case 'review_deposit':return NextResponse.json(await reviewDeposit(actor,op.depositId,op.approve,op.note??''));
      case 'log_visit':return NextResponse.json(await logVisit(actor,op.applicationId,op.outcome,op.promiseDate,op.note));
      case 'assign_collector':return NextResponse.json(await assignCollector(actor,op.applicationId,op.collectorId));
      case 'write_off':return NextResponse.json(await writeOff(actor,op.applicationId,op.reason));
      case 'propose_restructure':return NextResponse.json(await proposeRestructure(actor,op.applicationId,op.weeks,op.reason));
      case 'create_branch':return NextResponse.json(await createBranch(actor,op.name));
      case 'create_user':return NextResponse.json(await createUser(actor,op));
      case 'update_user':return NextResponse.json(await updateUser(actor,op.userId,op));
      case 'record_capital':return NextResponse.json(await recordCapital(actor,op));
    }
  }catch(error){
    const message=error instanceof Error?error.message:'';
    const conflict=/duplicate key|unique constraint/i.test(message);
    if(!conflict&&!(error instanceof z.ZodError)&&!messages[message])console.error('Operation failed',error);
    return NextResponse.json({error:conflict?'Data ini sudah ada (nama pengguna atau cabang sudah dipakai)':error instanceof z.ZodError?'Data yang dikirim tidak valid':messages[message]??'Permintaan gagal. Silakan coba lagi.'},{status:conflict?409:400});
  }
}
