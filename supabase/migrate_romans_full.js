#!/usr/bin/env node
// 로마서 한 번에 다: books 등록 + verses upsert(절수 검증) + notes 교체 +
// people 교체 + book_extras upsert, 그리고 books.available=true로 뒤집기.
// 재실행 시에도 중복이 안 생기게 notes/people은 book_id 범위만 지우고 새로 넣는다.
//
// 사용법
//   cd supabase
//   node migrate_romans_full.js --dry-run
//   node migrate_romans_full.js

'use strict';

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const DRY_RUN = process.argv.includes('--dry-run');
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tepsuxyfyrkylyhsngwo.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_ROLE_KEY) { console.error('환경변수 SUPABASE_SERVICE_ROLE_KEY가 필요합니다.'); process.exit(1); }

const BOOK_ID = 'romans';
const KRV_KEY = 'rm';
const DIR = path.join(__dirname, 'migration-output');
const STANDARD_COUNTS_PATH = path.join(__dirname, 'reference-data', 'standard_verse_counts.json');

const BOOK_META = {
  id: BOOK_ID,
  name_ko: '로마서',
  testament: 'new',
  order_num: 45,
  chapter_count: 16,
  available: false, // 아래 업로드가 다 성공한 뒤에 true로 뒤집는다
};

function loadJson(p) { if (!fs.existsSync(p)) throw new Error(`파일을 찾을 수 없습니다: ${p}`); return JSON.parse(fs.readFileSync(p, 'utf8')); }
function loadText(p) { if (!fs.existsSync(p)) throw new Error(`파일을 찾을 수 없습니다: ${p}`); return fs.readFileSync(p, 'utf8'); }

function validateVerseCounts(versesArr) {
  const standard = loadJson(STANDARD_COUNTS_PATH).books[KRV_KEY];
  const byCh = {};
  versesArr.forEach(v => { (byCh[v.chapter] = byCh[v.chapter] || []).push(v.verse); });
  const warnings = [];
  Object.keys(standard).forEach(ch => {
    const expected = standard[ch];
    const actual = (byCh[ch] || []).sort((a,b)=>a-b);
    if (actual.length !== expected) {
      const missing = [];
      const maxV = Math.max(expected, actual.length ? actual[actual.length-1] : 0);
      for (let v=1; v<=maxV; v++) if (!actual.includes(v)) missing.push(v);
      warnings.push(`  ⚠ ${ch}장: 표준 ${expected}절인데 실제 ${actual.length}절 (빠진 절: ${missing.join(', ')})`);
    }
  });
  const seen = new Set();
  versesArr.forEach(v => { const k=v.chapter+'-'+v.verse; if(seen.has(k)) warnings.push(`  ⚠ ${v.chapter}:${v.verse} 중복`); seen.add(k); });
  return warnings;
}

function buildVerseRows(versesArr) {
  return versesArr.map(v => ({ book_id: BOOK_ID, translation_id: 'krv', chapter: v.chapter, verse: v.verse, text: v.text }));
}
function buildNoteRows(notesArr) {
  return notesArr.map(n => ({
    book_id: BOOK_ID, chapter: n.chapter, verse_start: n.verse_start, verse_end: n.verse_end,
    title: n.title || null, body: n.body, grammar_note: n.grammar_note || null, refs: n.refs || null,
    src: n.src ? '<span class="src-tag src-confirmed">확인됨</span>' + n.src : null,
  }));
}
function buildPeopleRows(peopleArr) {
  return peopleArr.map(p => {
    if (!p.name || !p.body) throw new Error('people 항목에 name/body 없음: ' + JSON.stringify(p));
    return { book_id: BOOK_ID, name: p.name, role: p.role || null, verse_ref: p.verse_ref || null, body: p.body };
  });
}
async function upsertInChunks(supabase, table, rows, onConflict) {
  if (rows.length === 0) return;
  const chunk = 500;
  for (let i=0; i<rows.length; i+=chunk) {
    const slice = rows.slice(i, i+chunk);
    const { error } = await supabase.from(table).upsert(slice, onConflict ? { onConflict } : undefined);
    if (error) throw new Error(`${table} upsert 실패 (rows ${i}~${i+slice.length}): ${error.message}`);
  }
  console.log(`  ${table}: ${rows.length}행 upsert 완료`);
}

async function main() {
  console.log('파일 로딩 및 검증 중...\n');
  const verses = loadJson(path.join(DIR, 'romans_verses.json'));
  const notes = loadJson(path.join(DIR, 'romans_notes.json'));
  const people = loadJson(path.join(DIR, 'romans_people.json'));
  const contextHtml = loadText(path.join(DIR, 'romans_context_html.html'));
  const mapLocations = loadJson(path.join(DIR, 'romans_map_locations.json'));

  const warnings = validateVerseCounts(verses);
  if (warnings.length) { console.log('⚠ 절수 검증 실패:'); warnings.forEach(w=>console.log(w)); throw new Error('절수 불일치 — 원본 확인 필요'); }

  if (!Array.isArray(mapLocations)) throw new Error('map_locations 파일이 배열이 아닙니다.');
  mapLocations.forEach((loc,i) => {
    if (typeof loc.lat!=='number' || typeof loc.lng!=='number' || !loc.name) throw new Error(`map_locations[${i}] 오류: ${JSON.stringify(loc)}`);
  });

  const verseRows = buildVerseRows(verses);
  const noteRows = buildNoteRows(notes);
  const peopleRows = buildPeopleRows(people);

  console.log(`  verses: ${verseRows.length}절 (표준과 일치)`);
  console.log(`  notes: ${noteRows.length}개 (각주 있는 노트 ${noteRows.filter(r=>r.src).length}개)`);
  console.log(`  people: ${peopleRows.length}명`);
  console.log(`  context_html: ${contextHtml.length}자 (카드 ${(contextHtml.match(/class="card"/g)||[]).length}개)`);
  console.log(`  map_locations: ${mapLocations.length}곳 (${mapLocations.map(l=>l.name).join(', ')})`);

  if (DRY_RUN) { console.log('\n--dry-run 모드'); return; }

  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  console.log('\nSupabase에 업로드 중...\n');

  // books
  const { data: existing } = await supabase.from('books').select('id').eq('id', BOOK_ID).maybeSingle();
  if (!existing) {
    const { error } = await supabase.from('books').insert(BOOK_META);
    if (error) throw new Error('books insert 실패: ' + error.message);
    console.log('  books: 신규 등록 완료 (available=false로 시작)');
  } else {
    console.log('  books: 이미 등록됨');
  }

  await upsertInChunks(supabase, 'verses', verseRows, 'book_id,translation_id,chapter,verse');

  // notes: 이 책 범위만 지우고 새로
  const { error: delN } = await supabase.from('notes').delete().eq('book_id', BOOK_ID);
  if (delN) throw new Error('기존 notes 삭제 실패: ' + delN.message);
  await upsertInChunks(supabase, 'notes', noteRows, 'book_id,chapter,verse_start,verse_end');

  // book_extras upsert
  const { error: exErr } = await supabase.from('book_extras').upsert(
    { book_id: BOOK_ID, context_html: contextHtml, map_locations: mapLocations },
    { onConflict: 'book_id' }
  );
  if (exErr) throw new Error('book_extras upsert 실패: ' + exErr.message);
  console.log('  book_extras: 1행 upsert 완료');

  // people: 이 책 범위만 지우고 새로
  const { error: delP } = await supabase.from('people').delete().eq('book_id', BOOK_ID);
  if (delP) throw new Error('기존 people 삭제 실패: ' + delP.message);
  const { error: insP } = await supabase.from('people').insert(peopleRows);
  if (insP) throw new Error('people insert 실패: ' + insP.message);
  console.log(`  people: ${peopleRows.length}행 insert 완료`);

  // available=true로 뒤집기
  const { error: upBook } = await supabase.from('books').update({ available: true }).eq('id', BOOK_ID);
  if (upBook) throw new Error('books.available 갱신 실패: ' + upBook.message);
  console.log('  books: available=true로 갱신 완료');

  console.log('\n마이그레이션 완료.');
}

main().catch(err => { console.error('\n실패:', err.message); process.exit(1); });
