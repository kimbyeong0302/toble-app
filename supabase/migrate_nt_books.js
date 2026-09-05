#!/usr/bin/env node
// 고린도전서~요한계시록(21권) people + book_extras를 Supabase에 삽입한다.
// 사전 준비:
//   1. node migrate_add_character_profile.js -- character_profile 컬럼 확인/안내
//   2. node gen_nt_context_html.js           -- context_html / map_locations 파일 생성
//
// 사용법
//   cd supabase
//   node migrate_nt_books.js --dry-run           -- 전체 21권 dry-run
//   node migrate_nt_books.js --book=1cor         -- 고린도전서만 실제 삽입
//   node migrate_nt_books.js                     -- 전체 21권 실제 삽입
//
// 안전 규칙
//   - people: 해당 book_id의 기존 행 DELETE 후 INSERT (재실행 시 중복 방지)
//   - book_extras: book_id를 키로 UPSERT (기존 행이 있으면 덮어씀)
//   - 이 스크립트가 손대는 book_id는 --book 으로 지정한 책 또는 21권 목록뿐임

'use strict';

const fs   = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const DRY_RUN  = process.argv.includes('--dry-run');
const bookArg  = process.argv.slice(2).find(a => a.startsWith('--book='));
const ONLY_BOOK = bookArg ? bookArg.slice(7) : null;

const SUPABASE_URL    = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('환경변수 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.');
  process.exit(1);
}

const DIR          = path.join(__dirname, 'migration-output');
const PEOPLE_FILE  = path.join(DIR, 'toble_people_1cor_to_revelation_v3.json');

// 앱/DB가 쓰는 실제 book_id
const ALL_BOOK_IDS = [
  '1corinthians','2corinthians','galatians','ephesians','philippians','colossians',
  '1thessalonians','2thessalonians','1timothy','2timothy','titus','philemon',
  'hebrews','james','1peter','2peter','1john','2john','3john','jude','revelation',
];

// JSON 단축 ID → 앱/DB 실제 ID (전체 21권)
const ID_MAP = {
  '1cor':   '1corinthians',
  '2cor':   '2corinthians',
  'gal':    'galatians',
  'eph':    'ephesians',
  'phil':   'philippians',
  'col':    'colossians',
  '1thess': '1thessalonians',
  '2thess': '2thessalonians',
  '1tim':   '1timothy',
  '2tim':   '2timothy',
  'philem': 'philemon',
  'heb':    'hebrews',
  'jas':    'james',
  '1pet':   '1peter',
  '2pet':   '2peter',
  'rev':    'revelation',
};

const BOOK_META = {
  '1corinthians':   { name_ko: '고린도전서',     testament: 'new', order_num: 46, chapter_count: 16 },
  '2corinthians':   { name_ko: '고린도후서',     testament: 'new', order_num: 47, chapter_count: 13 },
  'galatians':      { name_ko: '갈라디아서',     testament: 'new', order_num: 48, chapter_count:  6 },
  'ephesians':      { name_ko: '에베소서',       testament: 'new', order_num: 49, chapter_count:  6 },
  'philippians':    { name_ko: '빌립보서',       testament: 'new', order_num: 50, chapter_count:  4 },
  'colossians':     { name_ko: '골로새서',       testament: 'new', order_num: 51, chapter_count:  4 },
  '1thessalonians': { name_ko: '데살로니가전서', testament: 'new', order_num: 52, chapter_count:  5 },
  '2thessalonians': { name_ko: '데살로니가후서', testament: 'new', order_num: 53, chapter_count:  3 },
  '1timothy':       { name_ko: '디모데전서',     testament: 'new', order_num: 54, chapter_count:  6 },
  '2timothy':       { name_ko: '디모데후서',     testament: 'new', order_num: 55, chapter_count:  4 },
  'titus':          { name_ko: '디도서',         testament: 'new', order_num: 56, chapter_count:  3 },
  'philemon':       { name_ko: '빌레몬서',       testament: 'new', order_num: 57, chapter_count:  1 },
  'hebrews':        { name_ko: '히브리서',       testament: 'new', order_num: 58, chapter_count: 13 },
  'james':          { name_ko: '야고보서',       testament: 'new', order_num: 59, chapter_count:  5 },
  '1peter':         { name_ko: '베드로전서',     testament: 'new', order_num: 60, chapter_count:  5 },
  '2peter':         { name_ko: '베드로후서',     testament: 'new', order_num: 61, chapter_count:  3 },
  '1john':          { name_ko: '요한일서',       testament: 'new', order_num: 62, chapter_count:  5 },
  '2john':          { name_ko: '요한이서',       testament: 'new', order_num: 63, chapter_count:  1 },
  '3john':          { name_ko: '요한삼서',       testament: 'new', order_num: 64, chapter_count:  1 },
  'jude':           { name_ko: '유다서',         testament: 'new', order_num: 65, chapter_count:  1 },
  'revelation':     { name_ko: '요한계시록',     testament: 'new', order_num: 66, chapter_count: 22 },
};

function loadJson(p) {
  if (!fs.existsSync(p)) throw new Error(`파일 없음: ${p}`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function loadText(p) {
  if (!fs.existsSync(p)) throw new Error(`파일 없음: ${p}`);
  return fs.readFileSync(p, 'utf8');
}

function buildPeopleRows(bookId, peopleArr) {
  if (!Array.isArray(peopleArr)) throw new Error(`${bookId}: people 필드가 배열이 아님`);
  return peopleArr.map((p, i) => {
    if (!p.name || !p.body)
      throw new Error(`${bookId}[${i}]: name/body 없음: ${JSON.stringify(p).slice(0,80)}`);
    return {
      book_id:           bookId,
      name:              p.name,
      role:              p.role  || null,
      verse_ref:         p.verse_ref || null,
      body:              p.body,
      character_profile: p.character_profile || null,
    };
  });
}

async function ensureBookRow(supabase, bookId) {
  const meta = BOOK_META[bookId];
  if (!meta) throw new Error(`BOOK_META에 ${bookId} 없음`);
  const { error } = await supabase.from('books').upsert(
    { id: bookId, ...meta, available: true },
    { onConflict: 'id' }
  );
  if (error) throw new Error(`books upsert 실패 (${bookId}): ${error.message}`);
}

async function processBook(supabase, bookId, bookEntry) {
  const contextHtml  = loadText(path.join(DIR, `${bookId}_context_html.html`));
  const mapLocations = loadJson(path.join(DIR, `${bookId}_map_locations.json`));

  if (!Array.isArray(mapLocations))
    throw new Error(`${bookId}: map_locations가 배열이 아님`);

  const peopleRows = buildPeopleRows(bookId, bookEntry.people || []);

  const cardCount = (contextHtml.match(/class="card"/g) || []).length;
  console.log(`\n[${bookId}] ${bookEntry.name || ''}`);
  console.log(`  context_html: ${contextHtml.length}자, ${cardCount}개 카드`);
  console.log(`  map_locations: ${mapLocations.length}곳`);
  console.log(`  people: ${peopleRows.length}명 (${peopleRows.map(r=>r.name).join(', ')})`);

  if (DRY_RUN) return;

  // books 테이블에 행이 없으면 upsert (FK 제약 충족)
  await ensureBookRow(supabase, bookId);
  console.log(`  → books: upsert 완료`);

  // people: 이 책 기존 행 삭제 후 삽입
  const { error: delErr } = await supabase.from('people').delete().eq('book_id', bookId);
  if (delErr) throw new Error(`${bookId} people DELETE 실패: ${delErr.message}`);

  if (peopleRows.length > 0) {
    const { error: insErr } = await supabase.from('people').insert(peopleRows);
    if (insErr) throw new Error(`${bookId} people INSERT 실패: ${insErr.message}`);
  }
  console.log(`  → people: ${peopleRows.length}행 삽입 완료`);

  // book_extras: book_id를 키로 upsert
  const { error: extErr } = await supabase
    .from('book_extras')
    .upsert({ book_id: bookId, context_html: contextHtml, map_locations: mapLocations },
             { onConflict: 'book_id' });
  if (extErr) throw new Error(`${bookId} book_extras UPSERT 실패: ${extErr.message}`);
  console.log(`  → book_extras: upsert 완료`);
}

async function main() {
  // people JSON 로드
  const peopleJson = loadJson(PEOPLE_FILE);
  const bookMap = {};
  for (const entry of (peopleJson.books || [])) {
    bookMap[entry.id] = entry;
  }

  const targets = ONLY_BOOK ? [ONLY_BOOK] : ALL_BOOK_IDS;

  // JSON 단축 ID 역매핑: 앱 ID → JSON ID
  const REVERSE_MAP = {};
  for (const [shortId, appId] of Object.entries(ID_MAP)) REVERSE_MAP[appId] = shortId;

  // 사전 검증
  const missing = [];
  for (const bookId of targets) {
    const jsonId = REVERSE_MAP[bookId] || bookId;
    if (!bookMap[jsonId])
      missing.push(`people JSON에 ${jsonId}(앱 ID: ${bookId}) 없음`);
    if (!fs.existsSync(path.join(DIR, `${bookId}_context_html.html`)))
      missing.push(`${bookId}_context_html.html 없음 → gen_nt_context_html.js 먼저 실행`);
    if (!fs.existsSync(path.join(DIR, `${bookId}_map_locations.json`)))
      missing.push(`${bookId}_map_locations.json 없음 → gen_nt_context_html.js 먼저 실행`);
  }
  if (missing.length) {
    console.error('사전 조건 미충족:');
    missing.forEach(m => console.error('  ✗ ' + m));
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log('=== DRY-RUN 모드: Supabase 에 아무것도 보내지 않습니다 ===\n');
  } else {
    console.log('=== 실제 삽입 모드 ===\n');
  }

  let supabase = null;
  if (!DRY_RUN) {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  }

  let ok = 0, fail = 0;
  for (const bookId of targets) {
    const jsonId = REVERSE_MAP[bookId] || bookId;
    try {
      await processBook(supabase, bookId, bookMap[jsonId]);
      ok++;
    } catch (e) {
      console.error(`  ✗ ${bookId} 실패: ${e.message}`);
      fail++;
    }
  }

  console.log(`\n=== 완료: 성공 ${ok}권 / 실패 ${fail}권 ===`);
  if (DRY_RUN) console.log('(dry-run — 실제 변경 없음)');
  if (fail > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
