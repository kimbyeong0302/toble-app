#!/usr/bin/env node
// 잘못된 단축 ID로 삽입된 데이터를 삭제한다 (1cor, 2cor 등)
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const WRONG_IDS = ['1cor','2cor','1thess','2thess','1tim','2tim','1pet','2pet'];

async function main() {
  for (const id of WRONG_IDS) {
    const { error: e1 } = await sb.from('people').delete().eq('book_id', id);
    const { error: e2 } = await sb.from('book_extras').delete().eq('book_id', id);
    const { error: e3 } = await sb.from('books').delete().eq('id', id);
    if (e1 || e2 || e3) console.error(id, e1?.message, e2?.message, e3?.message);
    else console.log(`✓ ${id} 삭제 완료`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
