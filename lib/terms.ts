import {createHash} from 'node:crypto';
import {calculateMonthlySchedule,canonicalJson} from './finance';

export type MonthlyPolicy={id:string;version:number;flat_interest_bps:number;late_fee_monthly_bps:number};
export const rupiah=(amount:number)=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(amount);

export function monthlyLateFee(principal:number,monthlyBps:number,lateDays:number){
  if(![principal,monthlyBps,lateDays].every(Number.isSafeInteger)||principal<0||monthlyBps<0||lateDays<0) throw new Error('Invalid late fee inputs');
  const value=(BigInt(principal)*BigInt(monthlyBps)*BigInt(lateDays)+150000n)/300000n;
  if(value>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Amount exceeds safe range');
  return Number(value);
}

export function monthlyTerms(name:string,principal:number,months:number,policy:MonthlyPolicy,start:Date,accountLast4:string){
  const calculation=calculateMonthlySchedule(principal,policy.flat_interest_bps,months,start);
  const schedule=calculation.installments;
  const daily=monthlyLateFee(principal,policy.late_fee_monthly_bps,1);
  const terms=[
    `Nasabah: ${name}. Pokok pinjaman ${rupiah(principal)}, bunga tetap selama tenor ${rupiah(calculation.interest)} (${policy.flat_interest_bps/100}%), tanpa biaya lain dalam demo ini. Total kewajiban pokok dan bunga ${rupiah(calculation.total)}. Rekening tujuan berakhir dengan ${accountLast4}.`,
    `Pinjaman dicicil ${months} kali secara proporsional. Setiap angsuran jatuh tempo tanggal 1, mulai ${schedule[0].dueAt}. Jumlah pokok dan bunga tiap bulan tertera pada jadwal di bawah. Pembulatan rupiah dibebankan pada angsuran awal agar totalnya tepat.`,
    `Apabila angsuran belum lunas setelah akhir tanggal 1, pinjaman berstatus terlambat. Denda sederhana bertambah harian sebesar ${policy.late_fee_monthly_bps/100}% dari pokok awal per 30 hari keterlambatan, setara sekitar ${rupiah(daily)} per hari. Denda tidak berbunga. Petugas dapat menghubungi nasabah secara patut untuk penyelesaian tunggakan.`,
    'Pembayaran dicatat setelah diverifikasi terhadap bukti bank. Nasabah dapat meminta penjelasan saldo dan koreksi melalui petugas atau perusahaan. Tidak ada penarikan dana otomatis dari perangkat nasabah.',
    'Jika jumlah, bunga, tenor, jadwal, biaya, atau ketentuan lain berubah setelah tanda tangan, versi perjanjian baru harus diperlihatkan dan ditandatangani kembali oleh nasabah sebelum berlaku. Pemilik hanya dapat menyetujui versi yang sama dengan yang ditandatangani.',
    'Izin berbagi lokasi merupakan pilihan terpisah dari tanda tangan ini. Menolak izin lokasi tidak mengubah kewajiban pembayaran. Dokumen ini adalah simulasi pengembangan dan bukan tanda tangan elektronik sah untuk pinjaman nyata.'
  ];
  const snapshot={principal,interest:calculation.interest,total:calculation.total,months,rateBps:policy.flat_interest_bps,
    lateFeeMonthlyBps:policy.late_fee_monthly_bps,policyVersion:policy.version,policyId:policy.id,
    repaymentFrequency:'monthly_first',schedule,accountLast4,terms};
  const hash=createHash('sha256').update(canonicalJson(snapshot)).digest('hex');
  return {snapshot,hash,terms};
}
