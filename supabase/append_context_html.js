#!/usr/bin/env node
// 지정한 책의 book_extras.context_html 뒤에 보완 HTML 조각을 이어붙인다.
// map_locations·people은 건드리지 않는다(update 사용).
// 사용법:
//   node append_context_html.js <book_id> <supplement.html> [--dry-run]

'use strict';

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const DRY_RUN = process.argv.includes('--dry-run');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const bookId = args[0];
const supplementPath = args[1];
if (!bookId || !supplementPath) {
  console.error('사용법: node append_context_html.js <book_id> <supplement.html> [--dry-run]');
  process.exit(1);
}
if (!fs.existsSync(supplementPath)) {
  console.error(`파일을 찾을 수 없습니다: ${supplementPath}`);
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tepsuxyfyrkylyhsngwo.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_ROLE_KEY) {
  console.error('환경변수 SUPABASE_SERVICE_ROLE_KEY가 필요합니다.');
  process.exit(1);
}

function countCards(html) {
  return (html.match(/class="card"/g) || []).length;
}

async function main() {
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: cur, error: readErr } = await supabase
    .from('book_extras')
    .select('context_html')
    .eq('book_id', bookId)
    .single();
  if (readErr) throw new Error(`context_html 조회 실패: ${readErr.message}`);
  if (!cur || !cur.context_html) throw new Error(`${bookId}의 기존 context_html이 비어 있습니다.`);

  const supplement = fs.readFileSync(supplementPath, 'utf8').trim();
  const supplementCards = countCards(supplement);
  const beforeCards = countCards(cur.context_html);

  // 이미 붙어 있는지 간단히 확인(중복 append 방지 — 첫 카드 <h2> 텍스트로 검사)
  const firstH2Match = supplement.match(/<h2>([^<]+)<\/h2>/);
  if (firstH2Match) {
    const marker = firstH2Match[1];
    if (cur.context_html.includes(marker)) {
      console.log(`  이미 "${marker}"가 기존 context_html에 존재합니다 — 중복 append를 막고 종료.`);
      return;
    }
  }

  const merged = cur.context_html.trimEnd() + '\n' + supplement + '\n';
  const afterCards = countCards(merged);

  console.log(`  ${bookId}: context_html ${cur.context_html.length}자 → ${merged.length}자`);
  console.log(`  카드 수: ${beforeCards} + ${supplementCards} = ${afterCards}`);

  if (DRY_RUN) {
    console.log('\n--dry-run: 아무것도 보내지 않았습니다.');
    return;
  }

  const { error: updErr, data: updData } = await supabase
    .from('book_extras')
    .update({ context_html: merged })
    .eq('book_id', bookId)
    .select('book_id');
  if (updErr) throw new Error(`update 실패: ${updErr.message}`);
  if (!updData || updData.length === 0) throw new Error(`book_id=${bookId} 행이 없어 아무 것도 못 바꿨습니다.`);
  console.log(`  update ${updData.length}행 완료 (book_id=${bookId})`);
}

main().catch((err) => {
  console.error('\n실패:', err.message);
  process.exit(1);
});
