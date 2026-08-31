#!/usr/bin/env node
// 누가복음 9~24장 추가 마이그레이션 — 1~8장은 이미 Supabase에 있으므로 절대 건드리지 않는다.
//   verses: upsert (book_id,translation_id,chapter,verse 기준) — 기존 행과 안 겹치므로 안전.
//   notes: book_id='luke' AND chapter BETWEEN 9 AND 24 범위만 delete 후 insert.
//          (기존 migrate.js의 replaceForBook은 book_id 전체를 지우기 때문에 그대로 쓰면
//          1~8장 노트가 다 날아간다 — 이번엔 반드시 챕터 범위로 한정한다.)
//
// 사용법
//   cd supabase
//   node migrate_luke_9to24.js --dry-run   먼저 검증만
//   node migrate_luke_9to24.js             실제 업로드

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

const VERSES_PATH = path.join(__dirname, '..', '..', 'files', 'luke_verses_9to24.json');
const NOTES_PATH = path.join(__dirname, '..', '..', 'files', 'luke_notes_9to24.json');

const CHAPTER_MIN = 9;
const CHAPTER_MAX = 24;

function loadJson(p) {
  if (!fs.existsSync(p)) throw new Error(`파일을 찾을 수 없습니다: ${p}`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function buildVerseRows(versesFile) {
  if (versesFile.book !== 'luke') throw new Error(`book 필드가 luke가 아닙니다: ${versesFile.book}`);
  if (versesFile.translation !== 'krv') throw new Error(`translation 필드가 krv가 아닙니다: ${versesFile.translation}`);
  const rows = [];
  for (const ch of versesFile.chapters) {
    if (ch.chapter < CHAPTER_MIN || ch.chapter > CHAPTER_MAX) {
      throw new Error(`verses 파일에 범위 밖 장(${ch.chapter}장)이 있습니다 — 9~24장만 허용됩니다.`);
    }
    for (const v of ch.verses) {
      rows.push({
        book_id: 'luke',
        translation_id: 'krv',
        chapter: ch.chapter,
        verse: v.v,
        text: v.text,
      });
    }
  }
  return rows;
}

function buildNoteRows(notesFile) {
  const rows = [];
  for (const n of notesFile) {
    if (n.chapter < CHAPTER_MIN || n.chapter > CHAPTER_MAX) {
      throw new Error(`notes 파일에 범위 밖 장(${n.chapter}장)이 있습니다 — 9~24장만 허용됩니다.`);
    }
    rows.push({
      book_id: 'luke',
      chapter: n.chapter,
      verse_start: n.verse_start,
      verse_end: n.verse_end,
      title: n.title || null,
      body: n.body,
      grammar_note: n.grammar_note || null,
      refs: n.refs || null,
      // source 필드가 src-tag/src-confirmed/src-partial 배지가 박힌 HTML이라, notes.src
      // 컬럼(출처 표시용)에는 이걸 넣는다. 평문 버전(n.src)은 DB에 넣을 곳이 없어 그대로 둔다.
      src: n.source || null,
    });
  }
  return rows;
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

async function replaceNotesForChapterRange(supabase, bookId, chapterMin, chapterMax, rows) {
  const { error: delError } = await supabase
    .from('notes')
    .delete()
    .eq('book_id', bookId)
    .gte('chapter', chapterMin)
    .lte('chapter', chapterMax);
  if (delError) throw new Error(`notes(${bookId} ${chapterMin}~${chapterMax}장) 삭제 실패: ${delError.message}`);
  if (rows.length === 0) return;
  const { error: insError } = await supabase.from('notes').insert(rows);
  if (insError) throw new Error(`notes(${bookId} ${chapterMin}~${chapterMax}장) insert 실패: ${insError.message}`);
  console.log(`  notes(${bookId} ${chapterMin}~${chapterMax}장): ${rows.length}행 교체 완료`);
}

async function main() {
  console.log('JSON 파일 로딩 및 검증 중...\n');
  const versesFile = loadJson(VERSES_PATH);
  const notesFile = loadJson(NOTES_PATH);

  const verseRows = buildVerseRows(versesFile);
  const noteRows = buildNoteRows(notesFile);

  console.log(`  verses: ${verseRows.length}절 (${CHAPTER_MIN}~${CHAPTER_MAX}장)`);
  console.log(`  notes: ${noteRows.length}개 (${CHAPTER_MIN}~${CHAPTER_MAX}장), 출처(src) 있는 노트: ${noteRows.filter(r => r.src).length}개`);

  if (DRY_RUN) {
    console.log('\n--dry-run 모드: Supabase에 아무것도 보내지 않았습니다.');
    return;
  }

  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  console.log('\nSupabase에 업로드 중...\n');
  await upsertInChunks(supabase, 'verses', verseRows, 'book_id,translation_id,chapter,verse');
  await replaceNotesForChapterRange(supabase, 'luke', CHAPTER_MIN, CHAPTER_MAX, noteRows);

  console.log('\n마이그레이션 완료.');
}

main().catch((err) => {
  console.error('\n마이그레이션 실패:', err.message);
  process.exit(1);
});
