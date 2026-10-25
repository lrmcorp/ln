import {readFile} from 'node:fs/promises';
import {pool} from '../lib/db';
const sql=await readFile(new URL('../db/schema.sql',import.meta.url),'utf8');
await pool.query(sql);
console.log('Database schema ready');
await pool.end();
