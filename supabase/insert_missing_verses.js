#!/usr/bin/env node
// STEP 3+4: 결손 63절 INSERT
// - dry-run 먼저, CONFLICT=0일 때만 실제 INSERT
// - UPDATE / DELETE / TRUNCATE 없음
// - 기존 verse는 절대 수정하지 않음
//
// 사용법:
//   node insert_missing_verses.js --dry-run   (조회만, DB 변경 없음)
//   node insert_missing_verses.js              (dry-run → INSERT → 검증)

'use strict';

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const DRY_RUN = process.argv.includes('--dry-run');

const JSON_FILE = path.join(__dirname, '../supabase/missing_verses_krv.json');
// 파일이 supabase 밖에 있을 수 있으므로 scratchpad도 시도
const SCRATCHPAD_FILE = 'C:/Users/kimby/AppData/Local/Temp/claude/C--Users-kimby-Desktop--------toble-app-toble-app/18059cb5-f910-4f60-9255-b34bc778d617/scratchpad/missing_verses_krv.json';

let rawData;
try {
  rawData = fs.readFileSync(JSON_FILE, 'utf8');
} catch {
  rawData = fs.readFileSync(SCRATCHPAD_FILE, 'utf8');
}
const data = JSON.parse(rawData);

// 절수 체계 차이로 제외된 3절 — INSERT 절대 금지
const VERSIFICATION_SKIP_KEYS = new Set([
  '1samuel|krv|30|31',
  'psalms|krv|72|20',
  '2corinthians|krv|13|14',
]);

const verses = data.verses.filter(e => {
  const k = `${e.book}|krv|${e.chapter}|${e.verse}`;
  return !VERSIFICATION_SKIP_KEYS.has(k);
});

if (verses.length !== 63) {
  console.error(`❌ 대상 절 수 오류: 예상 63, 실제 ${verses.length}`);
  process.exit(1);
}

async function main() {
  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(
    process.env.SUPABASE_URL || 'https://tepsuxyfyrkylyhsngwo.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  console.log('══════════════════════════════════════════════════');
  console.log(DRY_RUN ? ' STEP 3 — DRY-RUN (DB 변경 없음)' : ' STEP 3+4 — INSERT 실행');
  console.log('══════════════════════════════════════════════════');
  console.log(`대상: ${verses.length}절\n`);

  // ─────────────────────────────────────
  // [STEP 3] 존재 여부 확인 (dry-run 포함)
  // ─────────────────────────────────────
  const insertList   = [];
  const skipList     = [];
  const conflictList = [];

  // 책+장별로 묶어 조회
  const byBookChap = {};
  for (const e of verses) {
    const k = `${e.book}|${e.chapter}`;
    if (!byBookChap[k]) byBookChap[k] = [];
    byBookChap[k].push(e);
  }

  for (const [bk, bv] of Object.entries(byBookChap)) {
    const [bookId, chStr] = bk.split('|');
    const ch = Number(chStr);
    const verseNums = bv.map(e => e.verse);

    const { data: existing, error } = await sb.from('verses')
      .select('chapter, verse, text')
      .eq('book_id', bookId).eq('translation_id', 'krv')
      .eq('chapter', ch).in('verse', verseNums);

    if (error) {
      console.error(`조회 실패 ${bookId} ${ch}장: ${error.message}`);
      process.exit(1);
    }

    const existMap = {};
    (existing || []).forEach(r => { existMap[r.verse] = r.text; });

    for (const t of bv) {
      const label = `${t.book} ${t.chapter}:${t.verse}`;
      if (existMap[t.verse] === undefined) {
        insertList.push(t);
      } else if (existMap[t.verse] === t.text) {
        skipList.push(label);
      } else {
        conflictList.push({ label, dbText: existMap[t.verse], jsonText: t.text });
      }
    }
  }

  // DRY-RUN 결과 출력
  console.log('─── DRY-RUN 결과 ───────────────────────────────');
  console.log(`INSERT 예정: ${insertList.length}`);
  console.log(`SKIP 예정:   ${skipList.length}`);
  console.log(`CONFLICT:    ${conflictList.length}`);

  if (skipList.length > 0) {
    console.log('\nSKIP 목록:');
    skipList.forEach(s => console.log('  ' + s));
  }

  if (conflictList.length > 0) {
    console.log('\n❌ CONFLICT 목록:');
    conflictList.forEach(c => {
      console.log(`  ${c.label}`);
      console.log(`    기존 text: "${c.dbText}"`);
      console.log(`    신규 text: "${c.jsonText}"`);
    });
    console.log('\n⚠ CONFLICT 있음 — INSERT 중단');
    process.exit(1);
  }

  console.log('\nINSERT 예정 목록:');
  insertList.forEach(e => console.log(`  ${e.book} ${e.chapter}:${e.verse}`));

  if (DRY_RUN) {
    console.log('\n--dry-run: 여기까지. DB 변경 없음.');
    return;
  }

  // ─────────────────────────────────────
  // [STEP 4] 실제 INSERT
  // ─────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════');
  console.log(' STEP 4 — 실제 INSERT');
  console.log('══════════════════════════════════════════════════');

  const rows = insertList.map(e => ({
    book_id:        e.book,
    translation_id: 'krv',
    chapter:        e.chapter,
    verse:          e.verse,
    text:           e.text,
  }));

  let successCount = 0;
  let failCount    = 0;
  const failDetails = [];

  // 한 번에 INSERT (63절이라 한 배치로 충분)
  const { error: insErr } = await sb.from('verses').insert(rows);
  if (insErr) {
    // 배치 실패 시 한 절씩 재시도 (unique violation 가능성)
    console.log(`배치 INSERT 실패(${insErr.message}), 개별 INSERT 재시도...`);
    for (const row of rows) {
      const { error: e2 } = await sb.from('verses').insert([row]);
      if (e2) {
        if (e2.code === '23505') { // unique_violation
          skipList.push(`${row.book_id} ${row.chapter}:${row.verse} (이미 존재)`);
        } else {
          failCount++;
          failDetails.push(`${row.book_id} ${row.chapter}:${row.verse}: ${e2.message}`);
        }
      } else {
        successCount++;
      }
    }
  } else {
    successCount = rows.length;
  }

  console.log(`\nINSERT 결과: 성공 ${successCount} / 실패 ${failCount} / SKIP ${skipList.length}`);
  if (failDetails.length > 0) {
    console.log('실패 목록:');
    failDetails.forEach(f => console.log('  ' + f));
    process.exit(1);
  }

  // ─────────────────────────────────────
  // [INSERT 후 즉시 검증]
  // ─────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════');
  console.log(' INSERT 후 즉시 검증');
  console.log('══════════════════════════════════════════════════');

  let verifyOk = 0, verifyFail = 0, textMismatch = 0;
  const verifyFails = [];

  for (const [bk, bv] of Object.entries(byBookChap)) {
    const [bookId, chStr] = bk.split('|');
    const ch = Number(chStr);
    // 이번에 INSERT한 것만 검증
    const inserted = bv.filter(e => insertList.includes(e));
    if (inserted.length === 0) continue;

    const { data: check, error: cErr } = await sb.from('verses')
      .select('chapter, verse, text')
      .eq('book_id', bookId).eq('translation_id', 'krv')
      .eq('chapter', ch).in('verse', inserted.map(e => e.verse));

    if (cErr) {
      console.error(`검증 조회 실패 ${bookId} ${ch}장: ${cErr.message}`);
      continue;
    }

    const checkMap = {};
    (check || []).forEach(r => { checkMap[r.verse] = r.text; });

    for (const t of inserted) {
      const label = `${t.book} ${t.chapter}:${t.verse}`;
      if (checkMap[t.verse] === undefined) {
        verifyFail++;
        verifyFails.push(label + ': 존재하지 않음');
      } else if (checkMap[t.verse] !== t.text) {
        textMismatch++;
        verifyFails.push(label + ': text 불일치');
      } else {
        verifyOk++;
      }
    }
  }

  console.log(`존재 확인: ${verifyOk}절 OK`);
  console.log(`미존재:    ${verifyFail}절`);
  console.log(`text 불일치: ${textMismatch}절`);

  if (verifyFails.length > 0) {
    console.log('\n❌ 검증 실패:');
    verifyFails.forEach(f => console.log('  ' + f));
  } else {
    console.log('\n✅ 모든 INSERT된 verse 검증 완료');
  }

  // ─────────────────────────────────────
  // 최종 보고
  // ─────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════');
  console.log(' 최종 보고');
  console.log('══════════════════════════════════════════════════');
  console.log(`INSERT 대상: 63`);
  console.log(`실제 INSERT: ${successCount}`);
  console.log(`SKIP:        ${skipList.length}`);
  console.log(`CONFLICT:    0`);
  console.log(`실패:        ${failCount}`);
  console.log(`검증 OK:     ${verifyOk}`);
  console.log(`검증 실패:   ${verifyFail + textMismatch}`);

  const allOk = failCount === 0 && verifyFail === 0 && textMismatch === 0;
  console.log(allOk
    ? '\n══ STEP 5 전체 66권 검증 진행 가능 ══'
    : '\n⚠ 실패 항목 확인 필요');
}

main().catch(e => { console.error('실패:', e.message); process.exit(1); });
