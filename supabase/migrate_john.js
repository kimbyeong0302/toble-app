#!/usr/bin/env node
// 요한복음 1~5장 최초 마이그레이션 — 완전히 새 책이라 룻/누가와 달리 books 테이블에
// 행부터 만들어야 하고(FK), 기존 콘텐츠를 지울 위험도 없다(book_id='john'이 지금 아무
// 데이터도 없으므로 notes는 delete 없이 그냥 insert해도 안전하지만, 재실행 대비로
// upsert로 한다).
//
// 입력 JSON은 누가복음 때와 형식이 다르다:
//   john_verses_1to5.json — [{chapter, verse, text, sect?}, ...] 평평한 배열
//   john_notes_1to5.json  — [{chapter, verse_start, verse_end, title, body, grammar_note, refs, src}, ...]
//
// 사용법
//   cd supabase
//   node migrate_john.js --dry-run
//   node migrate_john.js

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

// 사용자가 말한 migration-data 폴더가 실제로는 없고, 지금까지 두 번 다 migration-output에
// 파일을 넣어주셨어서 여기도 그쪽을 본다.
const VERSES_PATH = path.join(__dirname, 'migration-output', 'john_verses_1to5.json');
const NOTES_PATH = path.join(__dirname, 'migration-output', 'john_notes_1to5.json');

const CHAPTER_MIN = 1;
const CHAPTER_MAX = 5;

function loadJson(p) {
  if (!fs.existsSync(p)) throw new Error(`파일을 찾을 수 없습니다: ${p}`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function buildVerseRows(versesArr) {
  if (!Array.isArray(versesArr)) throw new Error('verses 파일이 배열이 아닙니다.');
  return versesArr.map((v) => {
    if (v.chapter < CHAPTER_MIN || v.chapter > CHAPTER_MAX) {
      throw new Error(`verses 파일에 범위 밖 장(${v.chapter}장)이 있습니다 — 1~5장만 허용됩니다.`);
    }
    return {
      book_id: 'john',
      translation_id: 'krv',
      chapter: v.chapter,
      verse: v.verse,
      text: v.text,
    };
  });
}

function buildNoteRows(notesArr) {
  return notesArr.map((n) => {
    if (n.chapter < CHAPTER_MIN || n.chapter > CHAPTER_MAX) {
      throw new Error(`notes 파일에 범위 밖 장(${n.chapter}장)이 있습니다 — 1~5장만 허용됩니다.`);
    }
    return {
      book_id: 'john',
      chapter: n.chapter,
      verse_start: n.verse_start,
      verse_end: n.verse_end,
      title: n.title || null,
      body: n.body,
      grammar_note: n.grammar_note || null,
      refs: n.refs || null,
      // 이번 파일은 룻/누가 때와 달리 src가 이미 순수 텍스트라 배지 span이 없다 —
      // 화면에 있는 다른 출처 표시들과 톤을 맞추려고 "확인됨" 배지로 감싸서 넣는다.
      src: n.src ? '<span class="src-tag src-confirmed">확인됨</span>' + n.src : null,
    };
  });
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
  const notesArr = loadJson(NOTES_PATH);

  const verseRows = buildVerseRows(versesArr);
  const noteRows = buildNoteRows(notesArr);

  console.log(`  verses: ${verseRows.length}절 (${CHAPTER_MIN}~${CHAPTER_MAX}장)`);
  console.log(`  notes: ${noteRows.length}개, 출처(src) 있는 노트: ${noteRows.filter((r) => r.src).length}개`);

  if (DRY_RUN) {
    console.log('\n--dry-run 모드: Supabase에 아무것도 보내지 않았습니다.');
    return;
  }

  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  console.log('\nSupabase에 업로드 중...\n');

  console.log('books');
  await upsertInChunks(
    supabase,
    'books',
    [{ id: 'john', name_ko: '요한복음', testament: 'new', order_num: 43, chapter_count: 21, available: true }],
    'id'
  );

  console.log('john');
  await upsertInChunks(supabase, 'verses', verseRows, 'book_id,translation_id,chapter,verse');
  await upsertInChunks(supabase, 'notes', noteRows, 'book_id,chapter,verse_start,verse_end');

  console.log('\n마이그레이션 완료.');
}

main().catch((err) => {
  console.error('\n마이그레이션 실패:', err.message);
  process.exit(1);
});
