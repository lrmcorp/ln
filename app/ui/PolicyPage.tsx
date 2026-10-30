'use client';
import {PageHeader,Shell,shortDate,useAction,type StaffActor} from './Shell';
import {PolicyForm,type Policy} from './Console';

export default function PolicyPage({actor,policy}:{actor:StaffActor;policy:(Policy&{created_at:string})|null}){
  const action=useAction();
  return <Shell actor={actor} active="kebijakan">
    <PageHeader title="Kebijakan pinjaman" subtitle={policy?`Versi ${policy.version}, berlaku sejak ${shortDate(policy.created_at)}. Menyimpan membuat versi baru untuk pengajuan berikutnya; syarat yang sudah ditandatangani tidak berubah.`:'Belum ada kebijakan. Simpan untuk membuat versi pertama.'}/>
    <section className="card policyCard"><PolicyForm policy={policy} pending={action.pending} post={(path,body)=>action.run(path,body,{success:'Kebijakan baru tersimpan.'})}/></section>
    {action.feedback}
  </Shell>;
}
