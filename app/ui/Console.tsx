'use client';
import {useEffect,useState,useTransition} from 'react';

type Actor={id:string;name:string;email:string;role:'owner'|'officer'|'customer'};
type Application={id:string;status:string;requested_principal:string;approved_principal:string|null;interest_amount:string|null;term_weeks:number;customer_name:string;officer_name:string;submitted_at:string;snapshot:any;snapshot_hash:string|null;signed_at:string|null;paid:string;transfer_reference:string|null};
type Data={applications:Application[];customers:{id:string;name:string}[];totals:{net_cash:string;principal_outstanding:string;interest_receivable:string}|null;policy:{version:number;min_principal:string;max_principal:string;flat_interest_bps:number;min_weeks:number;max_weeks:number}|null;counts:{pending:number;active:number}|null};
const money=(value:string|number|null|undefined)=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(Number(value??0));
const labels:Record<string,string>={submitted:'Awaiting decision',approved:'Approved',signed:'Agreement signed',release_authorized:'Release authorized',transfer_initiated:'Transfer initiated',active:'Active',paid_off:'Paid off',closed:'Closed'};
const ownerSteps:Record<string,string>={submitted:'Decide on application',signed:'Authorize release',release_authorized:'Initiate transfer',transfer_initiated:'Confirm transfer',active:'Record payment',paid_off:'Close loan'};
function nextStep(role:Actor['role'],status:string){
  if(status==='closed') return 'Loan closed';
  if(role==='owner') return ownerSteps[status]??'Review record';
  if(role==='customer'&&status==='approved') return 'Review agreement';
  return 'View progress';
}

export default function Console({actor,initial}:{actor:Actor|null;initial:Data|null}){
  const [pending,startTransition]=useTransition();
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const apps=initial?.applications??[];
  const [selectedCustomer,setSelectedCustomer]=useState(initial?.customers[0]?.id??'');
  useEffect(()=>{
    const recent=sessionStorage.getItem('ln_new_customer');
    if(recent && initial?.customers.some(customer=>customer.id===recent)){
      setSelectedCustomer(recent);
      sessionStorage.removeItem('ln_new_customer');
      document.getElementById('new')?.scrollIntoView();
    }
  },[initial?.customers]);
  async function post(path:string,body:unknown){
    setError('');setMessage('');
    startTransition(async()=>{
      try{
        const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
        const result=await response.json();
        if(!response.ok) throw new Error(result.error??'Request failed');
        if(path==='/api/login'){window.location.hash='top';window.location.reload();return;}
        if(path==='/api/logout'){window.history.replaceState(null,'','/');window.location.reload();return;}
        if(path==='/api/actions'){
          const type=(body as {type?:string}).type;
          if(type==='customer'&&result.id) sessionStorage.setItem('ln_new_customer',result.id);
          window.location.hash=type==='customer'?'new':type==='policy'?'settings':'register';
          setMessage('Saved. Updating the register…');
        }
        window.location.reload();
      }catch(e){setError(e instanceof Error?e.message:'Request failed');}
    });
  }
  if(!actor) return <main className="loginPage"><div className="loginMark">LN <span>Operations</span></div><div className="loginGrid"><section><h1>Decisions with a clear trail.</h1><p>Local development workspace for loan intake, approval, transfer and repayment.</p><div className="demoNotice">Demo environment. No real customer information or money movement.</div></section><form method="post" className="loginForm" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);post('/api/login',{email:f.get('email'),password:f.get('password')});}}><h2>Sign in</h2><label>Email<input name="email" type="email" autoComplete="username" required placeholder="owner@local.test"/></label><label>Password<input name="password" type="password" autoComplete="current-password" required/></label><button disabled={pending}>{pending?'Signing in…':'Open workspace'}</button>{error&&<p className="error" role="alert">{error}</p>}</form></div></main>;
  const counts=initial?.counts??{pending:apps.filter(a=>a.status==='submitted').length,active:apps.filter(a=>a.status==='active').length};
  const priority=(status:string)=>actor.role==='owner'?(ownerSteps[status]?0:status==='closed'?2:1):status==='closed'?2:0;
  const orderedApps=[...apps].sort((a,b)=>priority(a.status)-priority(b.status));
  const lead=orderedApps[0];
  const ownerAction=orderedApps.find(app=>ownerSteps[app.status]);
  const openOfficerCases=apps.filter(app=>app.status!=='closed').length;
  const focus=actor.role==='owner'?(counts.pending?`${counts.pending} application${counts.pending===1?'':'s'} awaiting decision`:ownerAction?`Next: ${nextStep(actor.role,ownerAction.status)}`:'No action waiting'):
    actor.role==='officer'?(openOfficerCases?`${openOfficerCases} open case${openOfficerCases===1?'':'s'} in your register`:'No active cases'):
    lead?`${lead.customer_name}: ${labels[lead.status]??lead.status}`:'No loan yet';
  return <main className="shell" id="top"><header className="mast"><div className="brand">LN <span>Operations</span></div><div className="identity"><span>{actor.name}<small>{actor.role}</small></span><button className="textButton" onClick={()=>post('/api/logout',{})}>Sign out</button></div></header>
    <div className="workspace"><aside className="rail"><span className="railTitle">Workspace</span><a className="overviewLink" href="#overview">Overview</a><a href="#register">Loan register</a>{actor.role==='officer'&&<><a href="#new">New application</a><a href="#borrower">Add borrower</a></>}{actor.role==='owner'&&<a href="#settings">Loan policy</a>}<div className="railFoot">Development only<br/>Mock provider adapters</div></aside>
      <div className="content" id="overview"><div className="intro"><div><h1>{actor.role==='owner'?'Portfolio overview':actor.role==='officer'?'Your cases':'Your loan'}</h1><p>{actor.role==='owner'?'Review decisions, transfers, and ledger balances.':actor.role==='officer'?'Follow your cases and submit the next one.':'Review your terms and payment status.'}</p></div><span className="date">{new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Jakarta',dateStyle:'full'}).format(new Date())}</span></div>
      <section className="focusPanel" aria-label="Current focus"><div><small>Current focus</small><strong>{focus}</strong></div><a href={actor.role==='officer'?'#new':'#register'}>{actor.role==='officer'?'Start an application':'View cases'}</a></section>
      <section id="register" className="register"><div className="sectionHead"><div><h2>Loan register</h2><p>{apps.length} cases visible to your role</p></div></div>
        {apps.length===0?<div className="empty">No cases yet. {actor.role==='officer'?'Add a borrower or submit an application below.':'Cases will appear here when submitted.'}</div>:<div className="caseList">{orderedApps.map(app=><Case key={app.id} app={app} role={actor.role} pending={pending} post={post}/>)}</div>}
      </section>
      {actor.role==='owner'&&<section className="metrics" aria-label="Portfolio totals"><div><small>Principal outstanding</small><strong>{money(initial?.totals?.principal_outstanding)}</strong><span>Ledger balance</span></div><div><small>Interest receivable</small><strong>{money(initial?.totals?.interest_receivable)}</strong><span>Ledger balance</span></div><div><small>Awaiting decision</small><strong>{counts.pending}</strong><span>All applications</span></div><div><small>Active loans</small><strong>{counts.active}</strong><span>All applications</span></div></section>}
      {actor.role==='officer'&&<section className="newPanel" id="borrower"><div><h2>Add borrower</h2><p>Use synthetic details only in this development environment. Full identity evidence and verification remain outside this increment.</p></div><form method="post" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);post('/api/actions',{type:'customer',name:f.get('name'),nik:f.get('nik'),phone:f.get('phone'),bankName:f.get('bankName'),accountNumber:f.get('accountNumber')});}}><label>KTP name<input name="name" required/></label><label>16-digit NIK<input name="nik" inputMode="numeric" pattern="[0-9]{16}" required/></label><label>Phone<input name="phone" type="tel" required/></label><label>Bank name<input name="bankName" required/></label><label>Account number<input name="accountNumber" inputMode="numeric" pattern="[0-9]{5,30}" required/></label><button disabled={pending}>Save borrower</button></form></section>}
      {actor.role==='officer'&&<section className="newPanel" id="new"><div><h2>Submit an application</h2><p>Policy version {initial?.policy?.version}: {money(initial?.policy?.min_principal)} to {money(initial?.policy?.max_principal)}, {initial?.policy?.min_weeks} to {initial?.policy?.max_weeks} weeks. Flat term interest: {Number(initial?.policy?.flat_interest_bps??0)/100}%.</p></div><form method="post" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);post('/api/actions',{type:'create',customerId:f.get('customerId'),principal:Number(f.get('principal')),weeks:Number(f.get('weeks'))});}}><label>Borrower<select name="customerId" required value={selectedCustomer} onChange={e=>setSelectedCustomer(e.target.value)}>{initial?.customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Amount (IDR)<input name="principal" type="number" min={initial?.policy?.min_principal} max={initial?.policy?.max_principal} step="1" required/></label><label>Term (weeks)<input name="weeks" type="number" min={initial?.policy?.min_weeks} max={initial?.policy?.max_weeks} step="1" required/></label><button disabled={pending}>Submit for review</button></form></section>}
      {actor.role==='owner'&&<section className="newPanel" id="settings"><div><h2>Loan policy</h2><p>Current version {initial?.policy?.version}. Saving creates a new version for later approvals. Existing signed terms stay fixed.</p></div><form method="post" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);post('/api/actions',{type:'policy',minPrincipal:Number(f.get('minPrincipal')),maxPrincipal:Number(f.get('maxPrincipal')),flatInterestBps:Number(f.get('flatInterestBps')),minWeeks:Number(f.get('minWeeks')),maxWeeks:Number(f.get('maxWeeks'))});}}><label>Minimum IDR<input name="minPrincipal" type="number" min="1" defaultValue={initial?.policy?.min_principal} required/></label><label>Maximum IDR<input name="maxPrincipal" type="number" min="1" defaultValue={initial?.policy?.max_principal} required/></label><label>Flat interest (basis points)<input name="flatInterestBps" type="number" min="0" max="10000" defaultValue={initial?.policy?.flat_interest_bps} required/></label><label>Minimum weeks<input name="minWeeks" type="number" min="1" defaultValue={initial?.policy?.min_weeks} required/></label><label>Maximum weeks<input name="maxWeeks" type="number" min="1" defaultValue={initial?.policy?.max_weeks} required/></label><button disabled={pending}>Create policy version</button></form></section>}
      {pending&&<div className="feedback" role="status">Please wait…</div>}{error&&<div className="feedback error" role="alert">{error}<button onClick={()=>setError('')} aria-label="Dismiss error">Close</button></div>}{message&&<div className="feedback" role="status">{message}</div>}</div></div></main>;
}

function Case({app,role,pending,post}:{app:Application;role:Actor['role'];pending:boolean;post:(path:string,body:unknown)=>void}){
  const [open,setOpen]=useState(false);
  const principal=Number(app.approved_principal??app.requested_principal);
  const total=Number(app.approved_principal??0)+Number(app.interest_amount??0);
  return <article className="case"><div className="caseTop"><div><span className="caseStatus">{labels[app.status]??app.status}</span><h3>{app.customer_name}</h3><p>Submitted by {app.officer_name} · {new Date(app.submitted_at).toLocaleDateString('id-ID',{timeZone:'Asia/Jakarta'})}</p><p className="nextStep">{nextStep(role,app.status)}</p></div><div className="caseAmount"><strong>{money(principal)}</strong><button className="textButton" aria-expanded={open} aria-label={`${open?'Hide':'Show'} ${app.customer_name} case details`} onClick={()=>setOpen(!open)}>{open?'Hide details':role==='owner'&&ownerSteps[app.status]?'Review and act':'View details'}</button></div></div>
    {open&&<div className="caseBody" id={`case-${app.id}`}><div className="facts"><div><small>Term</small><strong>{app.term_weeks} weeks</strong></div><div><small>Scheduled total</small><strong>{app.approved_principal?money(total):'Pending decision'}</strong></div><div><small>Collected</small><strong>{money(app.paid)}</strong></div><div><small>Transfer reference</small><strong>{app.transfer_reference??'Not confirmed'}</strong></div></div>
      {app.snapshot&&<details><summary>Approved schedule and terms</summary><div className="schedule"><p>Flat interest: {Number(app.snapshot.rateBps)/100}% for the full term. Policy version {app.snapshot.policyVersion}. Demo agreement hash: {app.snapshot_hash?.slice(0,16)}…</p><table><thead><tr><th>Payment</th><th>Due</th><th>Principal</th><th>Interest</th></tr></thead><tbody>{app.snapshot.schedule.map((i:any)=><tr key={i.sequence}><td>{i.sequence}</td><td>{i.dueAt}</td><td>{money(i.principal)}</td><td>{money(i.interest)}</td></tr>)}</tbody></table></div></details>}
      <div className="actions">{role==='owner'&&app.status==='submitted'&&<button disabled={pending} onClick={()=>post('/api/actions',{type:'approve',applicationId:app.id})}>Approve application</button>}
        {role==='customer'&&app.status==='approved'&&<div className="actionGroup"><p>Demo signature adapter only. This action does not create a legally executed agreement.</p><button disabled={pending} onClick={()=>post('/api/actions',{type:'sign',applicationId:app.id})}>Simulate signature</button></div>}
        {role==='owner'&&app.status==='signed'&&<button disabled={pending} onClick={()=>post('/api/actions',{type:'authorize',applicationId:app.id})}>Authorize release</button>}
        {role==='owner'&&app.status==='release_authorized'&&<button disabled={pending} onClick={()=>post('/api/actions',{type:'initiate',applicationId:app.id,idempotencyKey:`demo-${app.id}`})}>Initiate transfer</button>}
        {role==='owner'&&app.status==='transfer_initiated'&&<form method="post" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);post('/api/actions',{type:'confirm',applicationId:app.id,bankReference:f.get('bankReference'),proof:f.get('proof')});}}><p>Demo bank adapter. Enter a numeric reference and a settlement evidence note.</p><label>Bank reference<input name="bankReference" inputMode="numeric" pattern="[0-9]+" required/></label><label>Evidence note<input name="proof" required/></label><button disabled={pending}>Confirm demo transfer</button></form>}
        {role==='owner'&&app.status==='active'&&<form method="post" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);post('/api/actions',{type:'payment',applicationId:app.id,bankReference:f.get('bankReference'),amount:Number(f.get('amount'))});}}><label>Bank payment reference<input name="bankReference" required/></label><label>Verified amount (IDR)<input name="amount" type="number" min="1" max={total-Number(app.paid)} required/></label><button disabled={pending}>Record verified payment</button></form>}
        {role==='owner'&&app.status==='paid_off'&&<button disabled={pending} onClick={()=>post('/api/actions',{type:'close',applicationId:app.id})}>Close reconciled loan</button>}
        {app.status==='closed'&&<p className="completion">All recorded obligations have been paid and the case is closed.</p>}</div></div>}
  </article>;
}
