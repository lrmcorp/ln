import {appendFileSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';

const target=resolve(process.argv[2]??'.env.local');
const secret=()=>randomBytes(32).toString('base64url');
if(existsSync(target)) {
  const current=readFileSync(target,'utf8');
  const additions=[];
  if(!/^DEMO_MANAGER_PASSWORD=/m.test(current)) additions.push(`DEMO_MANAGER_PASSWORD=${secret()}`);
  if(!/^DATA_ENCRYPTION_KEY=/m.test(current)) additions.push(`DATA_ENCRYPTION_KEY=${secret()}`);
  if(additions.length){
    appendFileSync(target,`${current.endsWith('\n')?'':'\n'}${additions.join('\n')}\n`);
    console.log('Missing local demo settings added');
  }else console.log('Local environment file already exists');
  process.exit(0);
}
const lines=[
  'DATABASE_URL=postgres://ln_dev:ln_dev_only@localhost:5432/ln_dev',
  `SESSION_SECRET=${secret()}`,
  `DEMO_OWNER_PASSWORD=${secret()}`,
  `DEMO_MANAGER_PASSWORD=${secret()}`,
  `DEMO_OFFICER_PASSWORD=${secret()}`,
  `DEMO_CUSTOMER_PASSWORD=${secret()}`,
  `DATA_ENCRYPTION_KEY=${secret()}`,
  'ENABLE_DEMO_ADAPTERS=true'
];
writeFileSync(target,lines.join('\n')+'\n',{flag:'wx',mode:0o600});
console.log('Local demo environment file created');
