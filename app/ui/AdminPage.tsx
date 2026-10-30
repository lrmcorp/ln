'use client';
import {useState} from 'react';
import {Shell,StatusChip,displayName,useAction,type StaffActor} from './Shell';

type Branch={id:string;name:string;staff:number;active_loans:number};
type User={id:string;username:string|null;email:string;name:string;role:string;active:boolean;branch_id:string|null;branch_name:string|null};
const roleNames:Record<string,string>={owner:'Pemilik',manager:'Manajer cabang',officer:'Petugas lapangan'};

export default function AdminPage({actor,branches,users}:{actor:StaffActor;branches:Branch[];users:User[]}){
  const action=useAction();
  return <Shell actor={actor} active="admin">
    <div className="intro"><div><h1>Cabang dan pengguna</h1><p>Tambah cabang, buat akun staf, atur ulang kata sandi, dan nonaktifkan akun yang tidak dipakai.</p></div></div>
    <section className="newPanel"><div><h2>Cabang</h2><ul className="plainList">{branches.map(b=><li key={b.id}><strong>{b.name}</strong> · {b.staff} staf · {b.active_loans} pinjaman aktif</li>)}</ul></div>
      <form method="post" onSubmit={e=>{e.preventDefault();action.run('/api/ops',{type:'create_branch',name:String(new FormData(e.currentTarget).get('name'))},{success:'Cabang ditambahkan.'});}}>
        <label>Nama cabang baru<input name="name" required maxLength={100}/></label><button disabled={action.pending}>Tambah cabang</button></form></section>
    <section className="newPanel"><div><h2>Akun staf baru</h2><p>Nama pengguna dipakai untuk masuk: huruf kecil, angka, titik, atau garis bawah. Berikan kata sandi awal langsung kepada orangnya.</p></div>
      <form method="post" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);action.run('/api/ops',{type:'create_user',username:String(f.get('username')),name:String(f.get('name')),role:String(f.get('role')),branchId:String(f.get('branchId')),password:String(f.get('password'))},{success:'Akun dibuat.'});}}>
        <label>Nama lengkap<input name="name" required maxLength={200}/></label><label>Nama pengguna<input name="username" required pattern="[a-z0-9._\-]{3,40}" autoCapitalize="none"/></label>
        <label>Peran<select name="role" defaultValue="officer"><option value="officer">Petugas lapangan</option><option value="manager">Manajer cabang</option><option value="owner">Pemilik</option></select></label>
        <label>Cabang<select name="branchId" required>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        <label>Kata sandi awal<input name="password" type="text" minLength={8} required autoComplete="new-password"/></label><button disabled={action.pending}>Buat akun</button></form></section>
    <section className="register"><div className="sectionHead"><div><h2>Semua staf</h2><p>{users.filter(u=>u.active).length} aktif dari {users.length}</p></div></div>
      <div className="caseList">{users.map(u=><UserRow key={u.id} user={u} branches={branches} self={u.id===actor.id} pending={action.pending} run={action.run}/>)}</div></section>
    {action.feedback}
  </Shell>;
}

function UserRow({user,branches,self,pending,run}:{user:User;branches:Branch[];self:boolean;pending:boolean;run:ReturnType<typeof useAction>['run']}){
  const [open,setOpen]=useState(false);
  return <article className="case"><div className="caseTop"><div>{user.active?<StatusChip tone="ok">Aktif</StatusChip>:<StatusChip tone="neutral">Nonaktif</StatusChip>}
      <h3>{displayName(user.name)}</h3><p>{roleNames[user.role]??user.role} · {user.branch_name??'Tanpa cabang'} · masuk sebagai <strong>{user.username??user.email}</strong></p></div>
    <div className="caseAmount"><button className="textButton" aria-expanded={open} onClick={()=>setOpen(!open)}>{open?'Tutup':'Kelola'}</button></div></div>
    {open&&<div className="caseBody"><div className="actions">
      <form method="post" className="inlineForm" onSubmit={e=>{e.preventDefault();run('/api/ops',{type:'update_user',userId:user.id,password:String(new FormData(e.currentTarget).get('password'))},{success:'Kata sandi diganti.'});}}>
        <label>Kata sandi baru<input name="password" type="text" minLength={8} required autoComplete="new-password"/></label><button className="secondary" disabled={pending}>Ganti kata sandi</button></form>
      <form method="post" className="inlineForm" onSubmit={e=>{e.preventDefault();run('/api/ops',{type:'update_user',userId:user.id,branchId:String(new FormData(e.currentTarget).get('branchId'))},{success:'Cabang dipindahkan.'});}}>
        <label>Pindah cabang<select name="branchId" defaultValue={user.branch_id??''}>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label><button className="secondary" disabled={pending}>Simpan cabang</button></form>
      {!self&&<button className={user.active?'danger':'secondary'} disabled={pending} onClick={()=>run('/api/ops',{type:'update_user',userId:user.id,active:!user.active},{success:user.active?'Akun dinonaktifkan.':'Akun diaktifkan.'})}>{user.active?'Nonaktifkan akun':'Aktifkan kembali'}</button>}
    </div></div>}</article>;
}
