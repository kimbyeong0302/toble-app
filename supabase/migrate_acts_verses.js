#!/usr/bin/env node
// 사도행전 본문만 먼저 올린다 — notes는 나중에 따로 보낼 예정이라 여기서는 건드리지 않는다.
// books 테이블에 사도행전이 아직 없으면 등록부터 한다(콘텐츠가 아직 다 안 채워졌으니
// available: false로 등록 — 완성도 점검에서 다 초록불 뜨면 그때 true로 바꾼다).
//
// 입력 파일: migration-output/acts_verses_final.json — [{chapter, verse, text}, ...]
//
// 사용법
//   cd supabase
//   node migrate_acts_verses.js --dry-run
//   node migrate_acts_verses.js

'use strict';

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const DRY_RUN = process.argv.includes('--dry-run');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tepsuxyfyrkylyhsngwo.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  console.error('환경변수 SUPABASE_SERVICE_ROLE_KEY가 필요합니다.');
  process.exit(1);
}

const BOOK_ID = 'acts';
const KRV_KEY = 'act'; // supabase/reference-data 파일들이 쓰는 약자
const VERSES_PATH = path.join(__dirname, 'migration-output', 'acts_verses_final.json');
const STANDARD_COUNTS_PATH = path.join(__dirname, 'reference-data', 'standard_verse_counts.json');

const BOOK_META = {
  id: BOOK_ID,
  name_ko: '사도행전',
  testament: 'new',
  order_num: 44,
  chapter_count: 28,
  available: false, // notes/people/book_extras까지 다 채우고 완성도 점검 통과하면 true로 변경
};

function loadJson(p) {
  if (!fs.existsSync(p)) throw new Error(`파일을 찾을 수 없습니다: ${p}`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function validateAgainstStandard(versesArr) {
  const standard = loadJson(STANDARD_COUNTS_PATH).books[KRV_KEY];
  if (!standard) throw new Error(`standard_verse_counts.json에 "${KRV_KEY}" 표준 절수가 없습니다.`);

  const byChapter = {};
  versesArr.forEach((v) => {
    (byChapter[v.chapter] = byChapter[v.chapter] || []).push(v.verse);
  });

  const warnings = [];
  Object.keys(standard).forEach((ch) => {
    const expected = standard[ch];
    const actual = (byChapter[ch] || []).sort((a, b) => a - b);
    if (actual.length !== expected) {
      const missing = [];
      const maxV = Math.max(expected, actual.length ? actual[actual.length - 1] : 0);
      for (let v = 1; v <= maxV; v++) if (!actual.includes(v)) missing.push(v);
      warnings.push(`  ⚠ ${ch}장: 표준 ${expected}절인데 실제 ${actual.length}절 (빠진 절: ${missing.join(', ')})`);
    }
  });

  // 중복 절 체크 — 같은 장:절이 두 번 이상 들어있으면 upsert 자체는 되지만 원본 파일 문제일 수 있다.
  const seen = new Set();
  versesArr.forEach((v) => {
    const key = v.chapter + '-' + v.verse;
    if (seen.has(key)) warnings.push(`  ⚠ ${v.chapter}:${v.verse} 중복 행 발견`);
    seen.add(key);
  });

  return warnings;
}

function buildVerseRows(versesArr) {
  return versesArr.map((v) => ({
    book_id: BOOK_ID,
    translation_id: 'krv',
    chapter: v.chapter,
    verse: v.verse,
    text: v.text,
  }));
}

async function upsertInChunks(supabase, table, rows, onConflict) {
  if (rows.length === 0) return;
  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabase.from(table).upsert(chunk, onConflict ? { onConflict } : undefined);
    if (error) throw new Error(`${table} upsert 실패 (rows ${i}~${i + chunk.length}): ${error.message}`);
  }
  console.log(`  ${table}: ${rows.length}행 upsert 완료`);
}

async function main() {
  console.log('JSON 파일 로딩 및 검증 중...\n');
  const versesArr = loadJson(VERSES_PATH);
  if (!Array.isArray(versesArr)) throw new Error('verses 파일이 배열이 아닙니다.');

  const warnings = validateAgainstStandard(versesArr);
  const verseRows = buildVerseRows(versesArr);

  console.log(`  verses: ${verseRows.length}절 (28장)`);
  if (warnings.length) {
    console.log('\n⚠ 절수 검증 경고:');
    warnings.forEach((w) => console.log(w));
  } else {
    console.log('  절수 검증 통과 — 28장 전부 표준 절수와 일치, 중복 없음.');
  }

  console.log('\nbooks 테이블 등록 상태: available=false로 새로 등록(또는 이미 있으면 유지)');
  console.log('  주의: notes는 이 스크립트에서 건드리지 않습니다 — 별도로 마이그레이션하세요.');

  if (DRY_RUN) {
    console.log('\n--dry-run 모드: Supabase에 아무것도 보내지 않았습니다.');
    return;
  }

  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  console.log('\nSupabase에 업로드 중...\n');

  const { data: existingBook } = await supabase.from('books').select('id').eq('id', BOOK_ID).maybeSingle();
  if (!existingBook) {
    const { error: bookErr } = await supabase.from('books').insert(BOOK_META);
    if (bookErr) throw new Error(`books insert 실패: ${bookErr.message}`);
    console.log('  books: 사도행전 신규 등록 완료 (available=false)');
  } else {
    console.log('  books: 이미 등록되어 있어 건드리지 않음');
  }

  await upsertInChunks(supabase, 'verses', verseRows, 'book_id,translation_id,chapter,verse');

  console.log('\n마이그레이션 완료. notes는 별도로 보낼 예정이므로 아직 건드리지 않았습니다.');
}

main().catch((err) => {
  console.error('\n마이그레이션 실패:', err.message);
  process.exit(1);
});
