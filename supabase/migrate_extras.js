#!/usr/bin/env node
// 토블 — index.html에 인라인으로 박혀 있는 4권(룻기·마태·마가·누가)의 배경(.ctx-book HTML)과
// 지도 좌표(MAP_LOCATIONS)를 직접 파싱해서 Supabase book_extras 테이블로 옮기는 1회성 스크립트.
//
// 참고: 요청받았던 "map_svg"는 실제로 존재하지 않습니다 — 지도는 SVG가 아니라 Leaflet 지도 +
// 좌표 배열(JS 객체 MAP_LOCATIONS)로 그려지고 있어서, 그 좌표 배열을 그대로 옮겨서
// book_extras.map_locations(jsonb)에 넣습니다. schema.sql도 이에 맞춰 컬럼명을 바꿔뒀습니다.
//
// 사용법
//   cd supabase
//   npm install   (이미 했다면 생략)
//   set SUPABASE_SERVICE_ROLE_KEY=...   (.env에 이미 있으면 자동으로 읽음)
//   node migrate_extras.js --dry-run    먼저 추출 결과만 확인 (migration-output/에 JSON 저장)
//   node migrate_extras.js              확인 후 실제로 Supabase에 upsert

'use strict';

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const DRY_RUN = process.argv.includes('--dry-run');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tepsuxyfyrkylyhsngwo.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!DRY_RUN && !SERVICE_ROLE_KEY) {
  console.error('환경변수 SUPABASE_SERVICE_ROLE_KEY가 필요합니다 (anon key로는 RLS 때문에 쓰기가 막혀 있습니다).');
  console.error('먼저 --dry-run으로 추출 결과만 확인해볼 수도 있습니다: node migrate_extras.js --dry-run');
  process.exit(1);
}

const INDEX_HTML_PATH = path.join(__dirname, '..', 'index.html');
const OUTPUT_DIR = path.join(__dirname, 'migration-output');

const BOOK_IDS = ['ruth', 'matthew', 'mark', 'luke'];

// ---------------------------------------------------------------
// `const NAME = <리터럴>;` 에서 <리터럴>을 괄호 깊이를 직접 세어 정확히 잘라내 평가한다.
// (migrate.js와 동일한 유틸 — 파일을 독립적으로 실행 가능하게 그대로 복제해둠)
// ---------------------------------------------------------------
function extractLiteral(src, varName) {
  const marker = new RegExp(`(?:const|let)\\s+${varName}\\s*=\\s*`);
  const m = marker.exec(src);
  if (!m) throw new Error(`${varName}을(를) index.html에서 찾지 못했습니다.`);

  let i = m.index + m[0].length;
  while (/\s/.test(src[i])) i++;
  const openChar = src[i];
  if (openChar !== '{' && openChar !== '[') {
    throw new Error(`${varName}의 값이 객체/배열 리터럴이 아닙니다 (offset ${i}).`);
  }
  const closeChar = openChar === '{' ? '}' : ']';

  let depth = 0;
  let inString = null;
  let escaped = false;
  const start = i;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inString = ch; continue; }
    if (ch === openChar) depth++;
    else if (ch === closeChar) {
      depth--;
      if (depth === 0) { i++; break; }
    }
  }
  if (depth !== 0) throw new Error(`${varName}의 괄호 짝을 찾지 못했습니다 — index.html 구조가 바뀐 것 같습니다.`);

  const literalText = src.slice(start, i);
  return new Function(`return (${literalText});`)();
}

// <div class="ctx-book" data-book="X" ...> 여는 태그 자체의 <div ~ 짝이 되는 </div>까지
// <div>/</div> 태그 깊이를 세어 정확히 찾고, 그 사이의 innerHTML만 돌려준다.
function extractDivInnerHtml(src, bookId) {
  const marker = `class="ctx-book" data-book="${bookId}"`;
  const markerIdx = src.indexOf(marker);
  if (markerIdx === -1) throw new Error(`${bookId}의 ctx-book 블록을 찾지 못했습니다.`);

  const tagStart = src.lastIndexOf('<div', markerIdx);
  const tagEnd = src.indexOf('>', markerIdx) + 1; // 여는 태그의 '>' 다음 = innerHTML 시작
  if (tagStart === -1 || tagEnd === 0) throw new Error(`${bookId}의 ctx-book 여는 태그를 파싱하지 못했습니다.`);

  const tagRe = /<div\b|<\/div>/g;
  tagRe.lastIndex = tagEnd;
  let depth = 1; // 이미 연 자기 자신의 <div> 하나
  let m;
  let innerEnd = -1;
  while ((m = tagRe.exec(src))) {
    if (m[0] === '<div') depth++;
    else depth--;
    if (depth === 0) { innerEnd = m.index; break; }
  }
  if (innerEnd === -1) throw new Error(`${bookId}의 ctx-book 닫는 태그를 찾지 못했습니다.`);

  return src.slice(tagEnd, innerEnd).trim();
}

async function upsertInChunks(supabase, table, rows, onConflict) {
  if (rows.length === 0) return;
  const { error } = await supabase.from(table).upsert(rows, onConflict ? { onConflict } : undefined);
  if (error) throw new Error(`${table} upsert 실패: ${error.message}`);
  console.log(`  ${table}: ${rows.length}행 upsert 완료`);
}

async function main() {
  const src = fs.readFileSync(INDEX_HTML_PATH, 'utf8');

  console.log('index.html에서 데이터 추출 중...\n');

  const mapLocations = extractLiteral(src, 'MAP_LOCATIONS');

  const rows = BOOK_IDS.map((bookId) => {
    const contextHtml = extractDivInnerHtml(src, bookId);
    const locations = mapLocations[bookId] || [];
    console.log(`  ${bookId}: 배경 HTML ${contextHtml.length}자, 지도 위치 ${locations.length}곳`);
    return { book_id: bookId, context_html: contextHtml, map_locations: locations };
  });

  if (DRY_RUN) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    rows.forEach((row) => {
      fs.writeFileSync(path.join(OUTPUT_DIR, `extras-${row.book_id}.json`), JSON.stringify(row, null, 2), 'utf8');
    });
    console.log(`\n--dry-run 모드: Supabase에 아무것도 보내지 않았습니다.`);
    console.log(`추출 결과를 ${OUTPUT_DIR} 에 JSON으로 저장했으니 내용을 확인해보세요.`);
    return;
  }

  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  console.log('\nSupabase에 업로드 중...\n');
  await upsertInChunks(supabase, 'book_extras', rows, 'book_id');

  console.log('\n마이그레이션 완료.');
}

main().catch((err) => {
  console.error('\n마이그레이션 실패:', err.message);
  process.exit(1);
});
