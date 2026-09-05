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
  const { data: ppl } = await sb.from('people').select('book_id').in('book_id', TARGET);
  const pplBooks = [...new Set((ppl||[]).map(r=>r.book_id))];

  const { data: ext } = await sb.from('book_extras').select('book_id').in('book_id', TARGET);
  const extBooks = [...new Set((ext||[]).map(r=>r.book_id))];

  console.log('=== people 테이블에 이미 있는 책 ===');
  console.log(pplBooks.length ? pplBooks.join(', ') : '없음');
  console.log('\n=== book_extras 테이블에 이미 있는 책 ===');
  console.log(extBooks.length ? extBooks.join(', ') : '없음');
}
main().catch(e => { console.error(e); process.exit(1); });
