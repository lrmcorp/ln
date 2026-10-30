import {NextResponse} from 'next/server';
import {z} from 'zod';
import {currentActor} from '@/lib/auth';
import {perform} from '@/lib/workflow';

const uuid=z.uuid();
const errors:Record<string,string>={
  'Application not found':'Pengajuan tidak ditemukan',
  Forbidden:'Anda tidak memiliki izin untuk tindakan ini',
  'Invalid policy limits':'Batas kebijakan tidak valid',
  'Invalid borrower details':'Data nasabah tidak valid',
  'Customer outside assigned branch':'Nasabah berada di luar cabang Anda',
  'No active policy':'Belum ada kebijakan aktif',
  'Outside policy limits':'Jumlah atau tenor di luar batas kebijakan',
  'Unassigned application':'Pengajuan ini tidak ditugaskan kepada Anda',
  'Unrelated application':'Pengajuan ini bukan milik Anda',
  'Approval not allowed':'Pengajuan ini tidak dapat disetujui',
  'Agreement is not available for signing':'Perjanjian belum tersedia untuk ditandatangani',
  'A verified signature provider is required':'Layanan tanda tangan terverifikasi diperlukan',
  'Agreement hash mismatch':'Data perjanjian tidak cocok',
  'Signed agreement required':'Perjanjian yang telah ditandatangani diperlukan',
  'Release authorization required':'Izin pencairan diperlukan',
  'Invalid idempotency key':'Kunci transaksi tidak valid',
  'Transfer not initiated':'Transfer belum dimulai',
  'Numeric bank reference and independent settlement proof required':'Referensi bank berupa angka dan bukti penyelesaian diperlukan',
  'A verified bank reconciliation adapter is required':'Layanan rekonsiliasi bank terverifikasi diperlukan',
  'Loan is not active':'Pinjaman belum aktif',
  'Ledger obligations must be paid off':'Seluruh kewajiban pembukuan harus lunas',
  'Invalid financial inputs':'Data keuangan tidak valid',
  'Amount exceeds safe range':'Jumlah melebihi batas yang didukung',
  'Unbalanced journal':'Catatan pembukuan tidak seimbang',
  'Identity review required':'Bukti identitas harus ditinjau pemilik sebelum persetujuan',
  'Identity review not allowed':'Bukti belum dapat ditinjau atau alasan kosong',
  'Identity evidence missing':'Bukti identitas tidak ditemukan',
  'Invalid weekly rates':'Tabel bunga mingguan tidak valid. Gunakan 1 sampai 52 minggu tanpa duplikat dan bunga 0 sampai 100%',
  'Signed terms mismatch':'Syarat yang ditandatangani tidak cocok dengan pengajuan'
};
const schema=z.discriminatedUnion('type',[
  z.object({type:z.literal('policy'),minPrincipal:z.number().int(),maxPrincipal:z.number().int(),flatInterestBps:z.number().int().optional(),minWeeks:z.number().int().optional(),maxWeeks:z.number().int().optional(),minMonths:z.number().int().optional(),maxMonths:z.number().int().optional(),lateFeeMonthlyBps:z.number().int().optional(),weeklyRates:z.array(z.object({weeks:z.number().int(),rateBps:z.number().int()})).min(1).max(20).optional(),firstLoanMax:z.number().int().optional(),repeatGrowthBps:z.number().int().optional(),maxInstallmentIncomeBps:z.number().int().optional()}),
  z.object({type:z.literal('customer'),name:z.string().min(1).max(200),nik:z.string().regex(/^[0-9]{16}$/),phone:z.string().min(8).max(20),bankName:z.string().min(1).max(100),accountNumber:z.string().regex(/^[0-9]{5,30}$/)}),
  z.object({type:z.literal('create'),customerId:uuid,principal:z.number().int().positive(),weeks:z.number().int().positive()}),
  z.object({type:z.literal('approve'),applicationId:uuid,reason:z.string().max(500).optional()}),
  z.object({type:z.literal('review_evidence'),applicationId:uuid,reason:z.string().min(1).max(500)}),
  z.object({type:z.literal('sign'),applicationId:uuid}),
  z.object({type:z.literal('authorize'),applicationId:uuid}),
  z.object({type:z.literal('initiate'),applicationId:uuid,idempotencyKey:z.string().min(1).max(100)}),
  z.object({type:z.literal('confirm'),applicationId:uuid,bankReference:z.string().regex(/^\d+$/),proof:z.string().min(1).max(500)}),
  z.object({type:z.literal('close'),applicationId:uuid})
]);
export async function POST(request:Request){
  try {
    const origin=request.headers.get('origin');
    if(origin && new URL(origin).host!==request.headers.get('host')) return NextResponse.json({error:'Permintaan dari asal berbeda ditolak'},{status:403});
    const actor=await currentActor();
    if(!actor) return NextResponse.json({error:'Silakan masuk terlebih dahulu'},{status:401});
    const action=schema.parse(await request.json());
    const result=await perform(actor,action);
    return NextResponse.json(result);
  }catch(error){
    const message=error instanceof Error?error.message:'Permintaan gagal';
    const conflict=/duplicate key|unique constraint/i.test(message);
    return NextResponse.json({error:conflict?'Referensi sudah digunakan atau tindakan telah dilakukan':error instanceof z.ZodError?'Data yang dikirim tidak valid':errors[message]??'Permintaan gagal. Silakan coba lagi.'},{status:conflict?409:400});
  }
}
