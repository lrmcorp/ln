import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {extractAmount,parseRupiah,readReceiptAmount,stopReceiptReader} from '../lib/receipt-reader';

after(stopReceiptReader);

test('rupiah amounts parse in Indonesian and English grouping',()=>{
  assert.equal(parseRupiah('100.000'),100000);
  assert.equal(parseRupiah('125.000,00'),125000);
  assert.equal(parseRupiah('125,000.00'),125000);
  assert.equal(parseRupiah('1.250.000'),1250000);
  assert.equal(parseRupiah('125.000,-'),125000);
  assert.equal(parseRupiah('12.50'),null);
  assert.equal(parseRupiah('1.000,000.00'),null);
});

test('labelled payment amount wins over fees, balances, references and dates',()=>{
  const text=['Transfer Berhasil','27 Okt 2026 14:32:10','Rekening tujuan','1234567890','Nominal','Rp 100.000','Biaya admin','Rp 2.500','Saldo akhir','Rp 3.450.000','No. Referensi','2026102714321098'].join('\n');
  assert.deepEqual(extractAmount(text),{amount:100000,line:'Rp 100.000'});
  assert.equal(extractAmount('To account 0098765432\nAmount IDR 125,000.00\nFee IDR 0.00')?.amount,125000);
  assert.equal(extractAmount('Tanggal 27-10-2026\nNo. Rek 1234567890'),null);
});

test('OCR reads the amount from synthetic receipt images',async()=>{
  const expected:Record<string,number>={'receipt-transfer-screenshot.png':100000,'receipt-transfer-english.png':125000,'receipt-kwitansi.png':125000,'receipt-photo.jpg':125000};
  for(const [file,amount] of Object.entries(expected)){
    const read=await readReceiptAmount(readFileSync(new URL(`./fixtures/${file}`,import.meta.url)));
    assert.equal(read?.amount,amount,file);
  }
});
