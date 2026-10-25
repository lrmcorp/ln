export type Installment = {sequence:number; dueAt:string; principal:number; interest:number};

export function canonicalJson(value:unknown):string {
  if(Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if(value!==null && typeof value==='object') return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  return JSON.stringify(value);
}

export function jakartaToday():Date {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  return new Date(`${parts}T12:00:00Z`);
}

export function calculateFlatSchedule(principal:number, bps:number, weeks:number, start:Date): {interest:number; total:number; installments:Installment[]} {
  if (![principal,bps,weeks].every(Number.isSafeInteger) || principal <= 0 || bps < 0 || weeks <= 0 || weeks > 260) throw new Error('Invalid financial inputs');
  const interest = Number((BigInt(principal) * BigInt(bps) + 5000n) / 10000n);
  if (!Number.isSafeInteger(interest)) throw new Error('Amount exceeds safe range');
  const installments = Array.from({length:weeks}, (_,i) => {
    const due = new Date(start);
    due.setUTCDate(due.getUTCDate()+7*(i+1));
    return {sequence:i+1, dueAt:due.toISOString().slice(0,10),
      principal: Math.floor(principal/weeks)+(i<principal%weeks?1:0),
      interest:Math.floor(interest/weeks)+(i<interest%weeks?1:0)};
  });
  return {interest,total:principal+interest,installments};
}

export function allocatePayment(amount:number, remainingPrincipal:number, remainingInterest:number) {
  if (![amount,remainingPrincipal,remainingInterest].every(Number.isSafeInteger) || amount<=0 || remainingPrincipal<0 || remainingInterest<0) throw new Error('Invalid payment');
  if (amount > remainingPrincipal+remainingInterest) throw new Error('Overpayment requires review');
  const interest=Math.min(amount,remainingInterest);
  return {interest,principal:amount-interest};
}

export function assertBalanced(lines:{debit:number;credit:number}[]) {
  if (!lines.length || lines.some(l=>!Number.isSafeInteger(l.debit)||!Number.isSafeInteger(l.credit)||l.debit<0||l.credit<0) ||
      lines.reduce((n,l)=>n+l.debit-l.credit,0)!==0) throw new Error('Unbalanced journal');
}
