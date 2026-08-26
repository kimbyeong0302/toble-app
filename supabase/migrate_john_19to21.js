#!/usr/bin/env node
// 요한복음 19~21장 추가 마이그레이션 — 1~18장은 이미 있으므로 건드리지 않는다.
// 19~21장은 완전히 새 장이라 upsert만으로 충분하고(기존 행과 안 겹침), notes도
// 델리트 없이 그냥 upsert한다.
//
// 입력 JSON은 요한복음 6~8장 때와 같은 평평한 배열 형식이다:
//   john_verses_19to21.json — [{chapter, verse, text, sect?}, ...]
//   john_notes_19to21.json  — [{chapter, verse_start, verse_end, title, body, grammar_note, refs, src}, ...]
//
// 사용법
//   cd supabase
//   node migrate_john_19to21.js --dry-run
//   node migrate_john_19to21.js

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

const VERSES_PATH = path.join(__dirname, 'migration-output', 'john_verses_19to21.json');
const NOTES_PATH = path.join(__dirname, 'migration-output', 'john_notes_19to21.json');

const CHAPTER_MIN = 19;
const CHAPTER_MAX = 21;

function loadJson(p) {
  if (!fs.existsSync(p)) throw new Error(`파일을 찾을 수 없습니다: ${p}`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function buildVerseRows(versesArr) {
  if (!Array.isArray(versesArr)) throw new Error('verses 파일이 배열이 아닙니다.');
  return versesArr.map((v) => {
    if (v.chapter < CHAPTER_MIN || v.chapter > CHAPTER_MAX) {
      throw new Error(`verses 파일에 범위 밖 장(${v.chapter}장)이 있습니다 — 19~21장만 허용됩니다.`);
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
      throw new Error(`notes 파일에 범위 밖 장(${n.chapter}장)이 있습니다 — 19~21장만 허용됩니다.`);
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
  await upsertInChunks(supabase, 'verses', verseRows, 'book_id,translation_id,chapter,verse');
  await upsertInChunks(supabase, 'notes', noteRows, 'book_id,chapter,verse_start,verse_end');

  console.log('\n마이그레이션 완료.');
}

main().catch((err) => {
  console.error('\n마이그레이션 실패:', err.message);
  process.exit(1);
});
