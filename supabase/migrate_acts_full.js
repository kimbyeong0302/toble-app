#!/usr/bin/env node
// 사도행전의 notes + book_extras + people을 한 번에 올리고 books.available=true로 뒤집는다.
// verses는 이미 migrate_acts_verses.js로 올려뒀으니 이 스크립트에서는 다시 손대지 않는다.
// notes는 이 책 범위(book_id=acts)만 지우고 새로 넣어 중복이 안 생기게 하고,
// people도 같은 이유로 delete-then-insert 방식을 쓴다(migrate_book_extras.js와 같은 규약).
//
// 사용법
//   cd supabase
//   node migrate_acts_full.js --dry-run
//   node migrate_acts_full.js

'use strict';

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const DRY_RUN = process.argv.includes('--dry-run');
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tepsuxyfyrkylyhsngwo.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_ROLE_KEY) { console.error('환경변수 SUPABASE_SERVICE_ROLE_KEY가 필요합니다.'); process.exit(1); }

const BOOK_ID = 'acts';
const DIR = path.join(__dirname, 'migration-output');

function loadJson(p) { if (!fs.existsSync(p)) throw new Error(`파일을 찾을 수 없습니다: ${p}`); return JSON.parse(fs.readFileSync(p, 'utf8')); }
function loadText(p) { if (!fs.existsSync(p)) throw new Error(`파일을 찾을 수 없습니다: ${p}`); return fs.readFileSync(p, 'utf8'); }

function buildNoteRows(notesArr) {
  return notesArr.map((n) => ({
    book_id: BOOK_ID,
    chapter: n.chapter,
    verse_start: n.verse_start,
    verse_end: n.verse_end,
    title: n.title || null,
    body: n.body,
    grammar_note: n.grammar_note || null,
    refs: n.refs || null,
    // 각주가 있으면 뱃지 span을 앞에 붙인다(다른 책의 notes.src와 동일한 형식)
    src: n.src ? '<span class="src-tag src-confirmed">확인됨</span>' + n.src : null,
  }));
}

function buildPeopleRows(peopleArr) {
  return peopleArr.map((p) => {
    if (!p.name || !p.body) throw new Error(`people 항목에 name/body가 없습니다: ${JSON.stringify(p)}`);
    return { book_id: BOOK_ID, name: p.name, role: p.role || null, verse_ref: p.verse_ref || null, body: p.body };
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
  console.log('파일 로딩 및 검증 중...\n');
  const notes1 = loadJson(path.join(DIR, 'acts_notes_1to7.json'));
  const notes2 = loadJson(path.join(DIR, 'acts_notes_8to28.json'));
  const noteRows = buildNoteRows([...notes1, ...notes2]);

  const contextHtml = loadText(path.join(DIR, 'acts_context_html.html'));
  const mapLocations = loadJson(path.join(DIR, 'acts_map_locations.json'));
  const peopleRows = buildPeopleRows(loadJson(path.join(DIR, 'acts_people.json')));

  // map_locations 형식 검증
  if (!Array.isArray(mapLocations)) throw new Error('map_locations 파일이 배열이 아닙니다.');
  mapLocations.forEach((loc, i) => {
    if (typeof loc.lat !== 'number' || typeof loc.lng !== 'number' || !loc.name) {
      throw new Error(`map_locations[${i}] 오류: ${JSON.stringify(loc)}`);
    }
  });

  console.log(`  notes: ${noteRows.length}개 (각주 있는 노트 ${noteRows.filter((r) => r.src).length}개)`);
  console.log(`  context_html: ${contextHtml.length}자 (카드 ${(contextHtml.match(/class="card"/g) || []).length}개)`);
  console.log(`  map_locations: ${mapLocations.length}곳 (${mapLocations.map((l) => l.name).join(', ')})`);
  console.log(`  people: ${peopleRows.length}명`);

  if (DRY_RUN) { console.log('\n--dry-run 모드: Supabase에 아무것도 보내지 않았습니다.'); return; }

  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  console.log('\nSupabase에 업로드 중...\n');

  // notes: 이 책 것만 지우고 새로 넣음(재실행 시 중복 방지)
  const { error: delNotesErr } = await supabase.from('notes').delete().eq('book_id', BOOK_ID);
  if (delNotesErr) throw new Error(`기존 notes 삭제 실패: ${delNotesErr.message}`);
  await upsertInChunks(supabase, 'notes', noteRows, 'book_id,chapter,verse_start,verse_end');

  // book_extras: 이 책 행 upsert
  const { error: extrasErr } = await supabase.from('book_extras')
    .upsert({ book_id: BOOK_ID, context_html: contextHtml, map_locations: mapLocations }, { onConflict: 'book_id' });
  if (extrasErr) throw new Error(`book_extras upsert 실패: ${extrasErr.message}`);
  console.log('  book_extras: 1행 upsert 완료');

  // people: 이 책 것만 지우고 새로 넣음
  const { error: delPeopleErr } = await supabase.from('people').delete().eq('book_id', BOOK_ID);
  if (delPeopleErr) throw new Error(`기존 people 삭제 실패: ${delPeopleErr.message}`);
  const { error: insPeopleErr } = await supabase.from('people').insert(peopleRows);
  if (insPeopleErr) throw new Error(`people insert 실패: ${insPeopleErr.message}`);
  console.log(`  people: ${peopleRows.length}행 insert 완료`);

  // books.available=true로 뒤집기 (지금까지 콘텐츠가 비어있어 false로 등록해뒀던 것)
  const { error: bookErr } = await supabase.from('books').update({ available: true }).eq('id', BOOK_ID);
  if (bookErr) throw new Error(`books.available 갱신 실패: ${bookErr.message}`);
  console.log('  books: available=true로 갱신 완료');

  console.log('\n마이그레이션 완료.');
}

main().catch((err) => { console.error('\n실패:', err.message); process.exit(1); });
