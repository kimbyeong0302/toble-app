#!/usr/bin/env node
// docs/NEW_BOOK_CHECKLIST.md의 "검증" 항목 1~7을 자동으로 확인한다.
// 결과는 표(✅/❌)로만 낸다 — 장문 설명은 여기서 하지 않는다.
//
// 사용법
//   cd supabase
//   node validate_book.js <book_id> [--regression=<book_id>]
//
// 예시
//   node validate_book.js john
//   node validate_book.js john --regression=mark

'use strict';

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tepsuxyfyrkylyhsngwo.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const INDEX_HTML_PATH = path.join(__dirname, '..', 'index.html');
const STANDARD_COUNTS_PATH = path.join(__dirname, 'reference-data', 'standard_verse_counts.json');

const targetBookId = process.argv[2];
const regressionArg = process.argv.find((a) => a.startsWith('--regression='));
const regressionBookId = regressionArg ? regressionArg.split('=')[1] : 'ruth';

if (!targetBookId) {
  console.error('사용법: node validate_book.js <book_id> [--regression=<book_id>]');
  process.exit(1);
}
if (!SERVICE_ROLE_KEY) {
  console.error('환경변수 SUPABASE_SERVICE_ROLE_KEY가 필요합니다.');
  process.exit(1);
}

// index.html에 정적으로 박힌 const 객체 리터럴(LOCATION_INFO, CHAPTER_EXAMPLES_BY_BOOK)을
// 문자열에서 그대로 뽑아 평가한다 — 둘 다 Supabase가 아니라 index.html 자체에만 있는
// 데이터라, 검증하려면 이 방법뿐이다. 중괄호를 문자열 안 내용까지 세면서 짝을 맞춘다.
function extractConstObject(source, constName) {
  const marker = 'const ' + constName + ' = {';
  const start = source.indexOf(marker);
  if (start === -1) return null;
  const braceStart = start + marker.length - 1;
  let depth = 0;
  let inString = null;
  let i = braceStart;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (ch === '\\') { i++; continue; }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inString = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  const literal = source.slice(braceStart, i);
  return new Function('return ' + literal)();
}

function standardTotalFor(orderNum, standardCounts) {
  const keys = Object.keys(standardCounts.books);
  const key = keys[orderNum - 1];
  if (!key) return null;
  const chapters = standardCounts.books[key];
  return Object.values(chapters).reduce((a, b) => a + b, 0);
}

function row(ok, label, note) {
  return `| ${ok ? '✅' : '❌'} | ${label} | ${note || ''} |`;
}

function printTable(title, rows) {
  console.log(`\n=== ${title} ===`);
  console.log('| 결과 | 항목 | 비고 |');
  console.log('|---|---|---|');
  rows.forEach((r) => console.log(row(r.ok, r.label, r.note)));
}

async function main() {
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const indexHtml = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  const locationInfo = extractConstObject(indexHtml, 'LOCATION_INFO') || {};
  const chapterExamples = extractConstObject(indexHtml, 'CHAPTER_EXAMPLES_BY_BOOK') || {};
  const standardCounts = JSON.parse(fs.readFileSync(STANDARD_COUNTS_PATH, 'utf8'));

  async function checkBook(bookId) {
    const { data: book, error: bookErr } = await supabase.from('books').select('*').eq('id', bookId).maybeSingle();
    if (bookErr || !book) {
      return { rows: [{ ok: false, label: '책 등록 확인 (books 테이블)', note: bookErr ? bookErr.message : '등록 안 됨' }], mapDetail: [] };
    }

    const [
      { data: firstCh },
      { data: lastCh },
      { count: totalVerseCount },
      { data: notesRows },
      { data: extras },
      { count: peopleCount },
    ] = await Promise.all([
      supabase.from('verses').select('verse').eq('book_id', bookId).eq('translation_id', 'krv').eq('chapter', 1).limit(1),
      supabase.from('verses').select('verse').eq('book_id', bookId).eq('translation_id', 'krv').eq('chapter', book.chapter_count).limit(1),
      supabase.from('verses').select('*', { count: 'exact', head: true }).eq('book_id', bookId).eq('translation_id', 'krv'),
      supabase.from('notes').select('src').eq('book_id', bookId),
      supabase.from('book_extras').select('context_html, map_locations').eq('book_id', bookId).maybeSingle(),
      supabase.from('people').select('*', { count: 'exact', head: true }).eq('book_id', bookId),
    ]);

    const rows = [];

    // 1. 본문 정상 표시 (첫 장·마지막 장)
    const hasFirst = (firstCh || []).length > 0;
    const hasLast = (lastCh || []).length > 0;
    rows.push({ ok: hasFirst && hasLast, label: '1. 본문 표시 (1장·마지막장)', note: `1장:${hasFirst ? '있음' : '없음'} ${book.chapter_count}장:${hasLast ? '있음' : '없음'}` });

    // 2. 각주 있는 노트 1개 + 없는 노트 1개
    const srcCount = (notesRows || []).filter((n) => n.src).length;
    const noSrcCount = (notesRows || []).filter((n) => !n.src).length;
    rows.push({ ok: srcCount > 0 && noSrcCount > 0, label: '2. 노트 (각주 있음/없음 각 1개)', note: `각주있음:${srcCount} 각주없음:${noSrcCount}` });

    // 3. 소제목 정상 표시 (CHAPTER_EXAMPLES_BY_BOOK — index.html 전용, DB에 없음)
    const sections = chapterExamples[bookId] || {};
    const sectionCount = Object.values(sections).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
    rows.push({ ok: sectionCount > 0, label: '3. 소제목 정상 표시', note: `${sectionCount}개 (index.html CHAPTER_EXAMPLES_BY_BOOK)` });

    // 4. 배경·인물 탭
    const hasContext = !!(extras && extras.context_html && extras.context_html.trim());
    const hasPeople = (peopleCount || 0) > 0;
    rows.push({ ok: hasContext && hasPeople, label: '4. 배경·인물 탭', note: `배경:${hasContext ? '있음' : '없음'} 인물:${peopleCount || 0}명` });

    // 5. 지도 마커 상세정보 + 절 목록 (별칭 포함해서 실제로 절이 매칭되는지까지 확인)
    const mapLocations = (extras && Array.isArray(extras.map_locations)) ? extras.map_locations : [];
    const mapDetail = [];
    let mapAllOk = mapLocations.length > 0;
    if (mapLocations.length > 0) {
      const { data: allVerses } = await supabase.from('verses').select('text').eq('book_id', bookId).eq('translation_id', 'krv');
      const texts = (allVerses || []).map((v) => v.text);
      mapLocations.forEach((loc) => {
        const hasInfo = !!locationInfo[loc.name];
        const terms = [loc.name, ...(Array.isArray(loc.search_aliases) ? loc.search_aliases : [])];
        const matchedTerm = terms.find((term) => texts.some((t) => t.includes(term)));
        const ok = hasInfo && !!matchedTerm;
        if (!ok) mapAllOk = false;
        mapDetail.push({ name: loc.name, locationInfo: hasInfo, verseMatch: !!matchedTerm, viaAlias: !!matchedTerm && matchedTerm !== loc.name, matchedTerm: matchedTerm || null });
      });
    }
    rows.push({ ok: mapAllOk, label: '5. 지도 마커 상세정보+절 목록', note: mapLocations.length ? `${mapLocations.length}곳 (세부는 아래 표)` : '지명 없음' });

    // 6. 완성도 점검 화면 기준 전부 초록불
    const standardTotal = standardTotalFor(book.order_num, standardCounts);
    const verseOk = (totalVerseCount || 0) > 0 && (standardTotal == null || totalVerseCount === standardTotal);
    const notesOk = (notesRows || []).length > 0;
    const mapNamesRegistered = mapLocations.length > 0 && mapLocations.every((loc) => !!locationInfo[loc.name]);
    const allGreen = verseOk && notesOk && hasContext && hasPeople && mapLocations.length > 0 && mapNamesRegistered;
    rows.push({
      ok: allGreen,
      label: '6. 완성도 점검 전부 초록불',
      note: `절:${totalVerseCount || 0}${standardTotal != null ? '/' + standardTotal : ''} 노트:${(notesRows || []).length} 배경:${hasContext ? '✓' : '✗'} 인물:${peopleCount || 0} 지도:${mapLocations.length} 지명등록:${mapNamesRegistered ? '✓' : '✗'}`,
    });

    return { rows, mapDetail, book };
  }

  const target = await checkBook(targetBookId);
  printTable(targetBookId, target.rows);

  if (target.mapDetail.length) {
    console.log('\n-- 5번 세부 (지도 지명별) --');
    console.log('| 결과 | 지명 | LOCATION_INFO | 절 매칭 |');
    console.log('|---|---|---|---|');
    target.mapDetail.forEach((d) => {
      const ok = d.locationInfo && d.verseMatch;
      const matchNote = d.verseMatch ? (d.viaAlias ? `✅ (별칭: ${d.matchedTerm})` : '✅') : '❌';
      console.log(`| ${ok ? '✅' : '❌'} | ${d.name} | ${d.locationInfo ? '✅' : '❌'} | ${matchNote} |`);
    });
  }

  // 7. 기존 책 하나 회귀 테스트
  const regression = await checkBook(regressionBookId);
  printTable(`${regressionBookId} (7. 회귀 테스트)`, regression.rows);

  const targetAllOk = target.rows.every((r) => r.ok);
  const regressionAllOk = regression.rows.every((r) => r.ok);
  console.log(`\n종합: ${targetBookId} ${targetAllOk ? '✅ 전체 통과' : '❌ 실패 항목 있음'} / 회귀(${regressionBookId}) ${regressionAllOk ? '✅ 전체 통과' : '❌ 실패 항목 있음'}`);
  if (!targetAllOk || !regressionAllOk) process.exitCode = 1;
}

main().catch((err) => {
  console.error('검증 실패:', err.message);
  process.exit(1);
});
