#!/usr/bin/env node
// 한 책의 book_extras(context_html + map_locations) + people을 한 번에 올린다.
// 세 입력 파일을 migration-output/에서 찾는다:
//   <book_id>_context_html.html — book_extras.context_html에 그대로 들어갈 HTML
//   <book_id>_map_locations.json — [{lat, lng, name}, ...]
//   <book_id>_people.json — [{name, role, verse_ref, body}, ...]
//
// book_extras는 book_id를 키로 upsert(이미 그 책 행이 있으면 덮어씀).
// people은 이 책의 기존 행을 전부 지우고 새로 넣는다(그래야 스크립트를 다시 돌려도
// 중복이 안 생긴다) — 그래서 book_extras보다 되돌리기 어려우니 --dry-run으로 먼저
// 몇 명이 들어갈지 확인하는 걸 권장한다.
//
// 사용법
//   cd supabase
//   node migrate_book_extras.js john --dry-run
//   node migrate_book_extras.js john

'use strict';

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const DRY_RUN = process.argv.includes('--dry-run');
const bookId = process.argv.slice(2).find((a) => !a.startsWith('--'));

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tepsuxyfyrkylyhsngwo.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!bookId) {
  console.error('사용법: node migrate_book_extras.js <book_id> [--dry-run]');
  process.exit(1);
}
if (!SERVICE_ROLE_KEY) {
  console.error('환경변수 SUPABASE_SERVICE_ROLE_KEY가 필요합니다.');
  process.exit(1);
}

const DIR = path.join(__dirname, 'migration-output');
const CONTEXT_HTML_PATH = path.join(DIR, `${bookId}_context_html.html`);
const MAP_LOCATIONS_PATH = path.join(DIR, `${bookId}_map_locations.json`);
const PEOPLE_PATH = path.join(DIR, `${bookId}_people.json`);

function loadFile(p) {
  if (!fs.existsSync(p)) throw new Error(`파일을 찾을 수 없습니다: ${p}`);
  return fs.readFileSync(p, 'utf8');
}

function buildPeopleRows(peopleArr) {
  if (!Array.isArray(peopleArr)) throw new Error('people 파일이 배열이 아닙니다.');
  return peopleArr.map((p) => {
    if (!p.name || !p.body) throw new Error(`people 항목에 name 또는 body가 없습니다: ${JSON.stringify(p)}`);
    return {
      book_id: bookId,
      name: p.name,
      role: p.role || null,
      verse_ref: p.verse_ref || null,
      body: p.body,
    };
  });
}

async function main() {
  console.log('파일 로딩 및 검증 중...\n');
  const contextHtml = loadFile(CONTEXT_HTML_PATH);
  const mapLocations = JSON.parse(loadFile(MAP_LOCATIONS_PATH));
  const peopleArr = JSON.parse(loadFile(PEOPLE_PATH));

  if (!Array.isArray(mapLocations)) throw new Error('map_locations 파일이 배열이 아닙니다.');
  mapLocations.forEach((loc, i) => {
    if (typeof loc.lat !== 'number' || typeof loc.lng !== 'number' || !loc.name) {
      throw new Error(`map_locations[${i}]에 lat/lng/name이 올바르지 않습니다: ${JSON.stringify(loc)}`);
    }
  });

  const peopleRows = buildPeopleRows(peopleArr);
  const cardCount = (contextHtml.match(/class="card"/g) || []).length;

  console.log(`  context_html: ${contextHtml.length}자, 카드 ${cardCount}개`);
  console.log(`  map_locations: ${mapLocations.length}곳 (${mapLocations.map((l) => l.name).join(', ')})`);
  console.log(`  people: ${peopleRows.length}명 (${peopleRows.map((p) => p.name).join(', ')})`);

  if (DRY_RUN) {
    console.log('\n--dry-run 모드: Supabase에 아무것도 보내지 않았습니다.');
    return;
  }

  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  console.log('\nSupabase에 업로드 중...\n');

  const { error: extrasErr } = await supabase
    .from('book_extras')
    .upsert({ book_id: bookId, context_html: contextHtml, map_locations: mapLocations }, { onConflict: 'book_id' });
  if (extrasErr) throw new Error(`book_extras upsert 실패: ${extrasErr.message}`);
  console.log('  book_extras: 1행 upsert 완료');

  const { error: delErr } = await supabase.from('people').delete().eq('book_id', bookId);
  if (delErr) throw new Error(`people 기존 행 삭제 실패: ${delErr.message}`);

  const { error: insErr } = await supabase.from('people').insert(peopleRows);
  if (insErr) throw new Error(`people insert 실패: ${insErr.message}`);
  console.log(`  people: ${peopleRows.length}행 insert 완료`);

  console.log('\n마이그레이션 완료.');
}

main().catch((err) => {
  console.error('\n마이그레이션 실패:', err.message);
  process.exit(1);
});
