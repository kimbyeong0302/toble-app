#!/usr/bin/env node
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const TARGET = ['1cor','2cor','galatians','ephesians','philippians','colossians',
  '1thess','2thess','1tim','2tim','titus','philemon',
  'hebrews','james','1pet','2pet','1john','2john','3john','jude','revelation'];

async function main() {
  const { data, error } = await sb.from('books').select('id, name_ko, available').in('id', TARGET);
  if (error) { console.error(error); process.exit(1); }
  console.log('books 테이블에 있는 책:', (data||[]).map(r=>`${r.id}(${r.name_ko})`).join(', '));
  console.log('총', (data||[]).length, '권');
  const missing = TARGET.filter(id => !(data||[]).find(r => r.id === id));
  console.log('누락된 책:', missing.length ? missing.join(', ') : '없음');
}
main().catch(e => { console.error(e); process.exit(1); });
