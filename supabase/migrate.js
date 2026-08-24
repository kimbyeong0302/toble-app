#!/usr/bin/env node
// 토블 — index.html에 인라인으로 박혀 있는 4권(룻기·마태·마가·누가)의 본문/학자노트/인물 데이터를
// 직접 파싱해서 Supabase(schema.sql 참고)로 옮기는 1회성 마이그레이션 스크립트.
//
// 사용법
//   cd supabase
//   npm install
//   set SUPABASE_SERVICE_ROLE_KEY=...   (PowerShell: $env:SUPABASE_SERVICE_ROLE_KEY="...")
//   node migrate.js --dry-run           먼저 실제 전송 없이 추출 결과만 확인
//   node migrate.js                     확인 후 실제로 Supabase에 upsert
//
// anon key로는 RLS 때문에 쓰기가 막혀 있어서, 이 스크립트는 반드시 service_role 키가 필요합니다.
// service_role 키는 절대 커밋하거나 index.html(클라이언트 코드)에 넣지 마세요 — 서버/로컬에서만 씁니다.

'use strict';

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const DRY_RUN = process.argv.includes('--dry-run');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tepsuxyfyrkylyhsngwo.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!DRY_RUN && !SERVICE_ROLE_KEY) {
  console.error('환경변수 SUPABASE_SERVICE_ROLE_KEY가 필요합니다 (anon key로는 RLS 때문에 쓰기가 막혀 있습니다).');
  console.error('Supabase 대시보드 > Project Settings > API > service_role 키를 복사한 뒤:');
  console.error('  PowerShell:  $env:SUPABASE_SERVICE_ROLE_KEY="..."');
  console.error('먼저 --dry-run으로 추출 결과만 확인해볼 수도 있습니다: node migrate.js --dry-run');
  process.exit(1);
}

const INDEX_HTML_PATH = path.join(__dirname, '..', 'index.html');
const OUTPUT_DIR = path.join(__dirname, 'migration-output');

const BOOK_IDS = ['ruth', 'matthew', 'mark', 'luke'];
const TESTAMENT = { ruth: 'old', matthew: 'new', mark: 'new', luke: 'new' };
const NOTE_VAR = {
  ruth: 'TEACHER_NOTES_RUTH',
  matthew: 'TEACHER_NOTES_MATTHEW',
  mark: 'TEACHER_NOTES_MARK',
  luke: 'TEACHER_NOTES_LUKE',
};
const PEOPLE_VAR = {
  ruth: 'PEOPLE_RUTH',
  matthew: 'PEOPLE_MATTHEW',
  mark: 'PEOPLE_MARK',
  luke: 'PEOPLE_LUKE',
};

// ---------------------------------------------------------------
// index.html에서 JS 리터럴을 안전하게 뽑아내는 유틸
// ---------------------------------------------------------------

// `const NAME = <리터럴>;` 에서 <리터럴> 구간을 괄호 깊이를 직접 세어 정확히 잘라낸다.
// 정규식만으로는 본문 안의 중괄호·따옴표(히브리어 인용, 콜론 등) 때문에 깨지기 쉬워 문자 단위로 순회한다.
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
  let inString = null; // 현재 문자열 안이면 그 따옴표 문자('\'', '"', '`')
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
  // 신뢰할 수 있는 우리 소스(index.html) 안의 리터럴만 평가한다.
  return new Function(`return (${literalText});`)();
}

// 지금 verse 텍스트에 실제 쓰이는 범위만 디코드 (개역한글 본문에는 &amp; 등이 거의 없지만 안전장치로 둠)
function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

// <div class="book-content" data-book="X"> ... 다음 book-content(또는 <script>) 전까지를
// 그 책의 영역으로 잘라내고, 그 안의 .verse 절마다 장-절 번호와 본문을 뽑는다.
function extractVerses(src, bookId) {
  const startTag = `class="book-content" data-book="${bookId}"`;
  const startIdx = src.indexOf(startTag);
  if (startIdx === -1) throw new Error(`${bookId}의 book-content 블록을 찾지 못했습니다.`);

  const nextBookIdx = src.indexOf('class="book-content" data-book="', startIdx + startTag.length);
  const scriptIdx = src.indexOf('<script>', startIdx);
  const candidates = [nextBookIdx, scriptIdx].filter((n) => n !== -1);
  const endIdx = candidates.length ? Math.min(...candidates) : src.length;
  const region = src.slice(startIdx, endIdx);

  const verseRe = /<div class="verse[^"]*" data-n="(\d+)-(\d+)">[\s\S]*?<span class="vtext">([\s\S]*?)<\/span>/g;
  const verses = [];
  let vm;
  while ((vm = verseRe.exec(region))) {
    verses.push({
      chapter: Number(vm[1]),
      verse: Number(vm[2]),
      text: decodeEntities(vm[3].trim()),
    });
  }
  if (verses.length === 0) {
    throw new Error(`${bookId}에서 절을 하나도 찾지 못했습니다 — HTML 구조가 바뀐 것 같습니다.`);
  }
  return verses;
}

// "1-16" 같은 노트/키를 { chapter, verse }로 분해 (지금 데이터는 전부 이 단순 형태)
function parseVerseKey(key) {
  const [chapter, verse] = key.split('-').map(Number);
  return { chapter, verse };
}

// ---------------------------------------------------------------
// Supabase 업로드
// ---------------------------------------------------------------

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

async function replaceForBook(supabase, table, bookId, rows) {
  // notes/people은 자연키가 없어서, 재실행해도 중복이 안 쌓이도록 그 책 데이터를 지우고 새로 넣는다.
  const { error: delError } = await supabase.from(table).delete().eq('book_id', bookId);
  if (delError) throw new Error(`${table}(${bookId}) 삭제 실패: ${delError.message}`);
  if (rows.length === 0) return;
  const { error: insError } = await supabase.from(table).insert(rows);
  if (insError) throw new Error(`${table}(${bookId}) insert 실패: ${insError.message}`);
  console.log(`  ${table}(${bookId}): ${rows.length}행 교체 완료`);
}

// ---------------------------------------------------------------
// 메인
// ---------------------------------------------------------------

async function main() {
  const src = fs.readFileSync(INDEX_HTML_PATH, 'utf8');

  console.log('index.html에서 데이터 추출 중...\n');

  const booksLiteral = extractLiteral(src, 'BOOKS');
  const availableBooks = booksLiteral.filter((b) => b.available && BOOK_IDS.includes(b.id));
  const bookRows = availableBooks.map((b) => ({
    id: b.id,
    name_ko: b.name,
    testament: TESTAMENT[b.id],
    order_num: booksLiteral.indexOf(b) + 1, // BOOKS 배열 안의 순서를 그대로 목차 순서로 사용
    chapter_count: b.chapters,
    available: true,
  }));

  const perBook = {};
  for (const bookId of BOOK_IDS) {
    const verses = extractVerses(src, bookId);
    const notesObj = extractLiteral(src, NOTE_VAR[bookId]);
    const peopleArr = extractLiteral(src, PEOPLE_VAR[bookId]);

    const verseRows = verses.map((v) => ({
      book_id: bookId,
      translation_id: 'krv',
      chapter: v.chapter,
      verse: v.verse,
      text: v.text,
    }));

    const noteRows = Object.entries(notesObj).map(([key, n]) => {
      const { chapter, verse } = parseVerseKey(key);
      return {
        book_id: bookId,
        chapter,
        verse_start: verse,
        verse_end: verse,
        title: n.t || null,
        body: n.b,
        grammar_note: n.g || null,
        refs: n.r || null,
      };
    });

    const peopleRows = peopleArr.map((p) => ({
      book_id: bookId,
      name: p.n,
      role: p.role || null,
      verse_ref: p.v || null,
      body: p.b,
    }));

    perBook[bookId] = { verseRows, noteRows, peopleRows };
    console.log(`  ${bookId}: 본문 ${verseRows.length}절, 학자노트 ${noteRows.length}개, 인물 ${peopleRows.length}명`);
  }

  if (DRY_RUN) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUTPUT_DIR, 'books.json'), JSON.stringify(bookRows, null, 2), 'utf8');
    for (const bookId of BOOK_IDS) {
      fs.writeFileSync(path.join(OUTPUT_DIR, `${bookId}.json`), JSON.stringify(perBook[bookId], null, 2), 'utf8');
    }
    console.log(`\n--dry-run 모드: Supabase에 아무것도 보내지 않았습니다.`);
    console.log(`추출 결과를 ${OUTPUT_DIR} 에 JSON으로 저장했으니 내용을 확인해보세요.`);
    return;
  }

  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  console.log('\nSupabase에 업로드 중...\n');

  console.log('books / translations');
  await upsertInChunks(supabase, 'books', bookRows, 'id');
  await upsertInChunks(supabase, 'translations', [{ id: 'krv', name_ko: '개역한글' }], 'id');

  for (const bookId of BOOK_IDS) {
    console.log(`\n${bookId}`);
    await upsertInChunks(
      supabase,
      'verses',
      perBook[bookId].verseRows,
      'book_id,translation_id,chapter,verse'
    );
    await replaceForBook(supabase, 'notes', bookId, perBook[bookId].noteRows);
    await replaceForBook(supabase, 'people', bookId, perBook[bookId].peopleRows);
  }

  console.log('\n마이그레이션 완료.');
}

main().catch((err) => {
  console.error('\n마이그레이션 실패:', err.message);
  process.exit(1);
});
