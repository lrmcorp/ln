import {copyFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createWorker,type Worker} from 'tesseract.js';

export type ReadAmount={amount:number;line:string};

const amountPattern=/(rp|idr)?[.:]?\s*(\d{1,3}(?:[.,]\s?\d{3})+(?:[.,]\d{2})?|\d{4,9})(?:\s?,-|\s?\.-)?/gi;
const wanted=/nominal|jumlah|total|amount|sebesar|transfer|bayar|pembayaran|setor|angsuran/i;
const unwanted=/biaya|admin|fee|saldo|balance|ref|rek|account|no\.|nomor|tanggal|date|telp|hp|kode|npwp|id\b/i;

// Reads Indonesian (100.000 / 100.000,00) and English (100,000.00) grouping; returns whole rupiah.
export function parseRupiah(raw:string){
  const text=raw.replace(/\s/g,'').replace(/(,-|\.-)$/,'');
  if(/^\d{4,9}$/.test(text))return Number(text);
  const match=/^(\d{1,3})((?:[.,]\d{3})+)([.,]\d{2})?$/.exec(text);
  if(!match)return null;
  const groups=match[2];
  if(new Set(groups.match(/[.,]/g)).size!==1)return null;
  if(match[3]&&match[3][0]===groups[0])return null;
  return Number(match[1]+groups.replace(/[.,]/g,''));
}

// Picks the most likely paid amount from OCR text: labelled, currency-marked figures win; fees, balances and references lose.
export function extractAmount(text:string):ReadAmount|null{
  const lines=text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  let best=null as {amount:number;line:string;score:number}|null;
  for(const [index,line] of lines.entries()){
    for(const match of line.matchAll(amountPattern)){
      const amount=parseRupiah(match[2]);
      if(amount===null||amount<1000||amount>1000000000)continue;
      const currency=!!match[1];
      if(!currency&&/^\d+$/.test(match[2]))continue;
      // A label on the same line wins; a bare amount takes its label from the line above.
      const ownLabel=line.replace(match[0],'');
      const label=/[a-z]{3}/i.test(ownLabel)?ownLabel:lines[index-1]??'';
      let score=(currency?3:0)+(wanted.test(label)?3:0);
      if(unwanted.test(label))score-=6;
      if(/\d[/-]\d/.test(ownLabel))score-=1;
      if(!best||score>best.score||(score===best.score&&amount>best.amount))best={amount,line,score};
    }
  }
  return best&&best.score>=3?{amount:best.amount,line:best.line}:null;
}

let worker:Promise<Worker>|null=null;
async function ocrWorker(){
  // Language data ships in npm packages, so the server never downloads models at runtime.
  // The path is built from the app folder because the Next.js bundler rewrites require.resolve.
  worker??=(async()=>{
    const langPath=join(tmpdir(),'ln-ocr-lang');
    await mkdir(langPath,{recursive:true});
    for(const code of ['ind','eng'])await copyFile(join(process.cwd(),'node_modules','@tesseract.js-data',code,'4.0.0_best_int',`${code}.traineddata.gz`),join(langPath,`${code}.traineddata.gz`));
    return createWorker(['ind','eng'],1,{langPath,gzip:true,cacheMethod:'none'});
  })().catch(error=>{worker=null;throw error;});
  return worker;
}

// Idle workers hold ~100 MB, so they stop after a minute without receipts.
let idleTimer:NodeJS.Timeout|null=null;
export async function stopReceiptReader(){
  if(idleTimer)clearTimeout(idleTimer);
  idleTimer=null;
  const current=worker;worker=null;
  if(current)await (await current).terminate();
}

let queue:Promise<unknown>=Promise.resolve();
export async function readReceiptAmount(image:Uint8Array):Promise<ReadAmount|null>{
  const run=queue.then(async()=>{
    if(idleTimer)clearTimeout(idleTimer);
    try{
      const result=await (await ocrWorker()).recognize(Buffer.from(image));
      return extractAmount(result.data.text);
    }finally{
      idleTimer=setTimeout(()=>void stopReceiptReader(),60000);
      idleTimer.unref();
    }
  });
  queue=run.catch(()=>undefined);
  return run;
}
