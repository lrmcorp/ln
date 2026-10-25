import {existsSync, writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';

const target=resolve(process.argv[2]??'.env.local');
if(existsSync(target)) {
  console.log('Local environment file already exists');
  process.exit(0);
}
const secret=()=>randomBytes(32).toString('base64url');
const lines=[
  'DATABASE_URL=postgres://ln_dev:ln_dev_only@localhost:5432/ln_dev',
  `SESSION_SECRET=${secret()}`,
  `DEMO_OWNER_PASSWORD=${secret()}`,
  `DEMO_OFFICER_PASSWORD=${secret()}`,
  `DEMO_CUSTOMER_PASSWORD=${secret()}`,
  'ENABLE_DEMO_ADAPTERS=true'
];
writeFileSync(target,lines.join('\n')+'\n',{flag:'wx',mode:0o600});
console.log('Local demo environment file created');
