#!/usr/bin/env node
// krv_full_bible.json(개역한글판 66권 전체 원문)에서 한 책(또는 그 중 일부 장)을 뽑아
// verses 마이그레이션 JSON([{chapter, verse, text}, ...])으로 변환한다.
//
// krv_full_bible.json은 100% 정확하다고 보장되지 않는다(예: 사도행전 23장에 실제로
// 35절이 통째로 빠진 사례가 발견됨). 그래서 추출한 장마다 절 수를 표준 절수
// (reference-data/standard_verse_counts.json — KJV 절 구분 기준, 66권 전체가
// krv_full_bible.json과 절 구분 방식이 일치함을 대조 확인해둔 참조 테이블)와 대조해서
// 안 맞으면 경고를 띄운다. 경고가 떠도 파일은 그대로 써주니, 실제로 원문이 빠진 건지
// 확인한 뒤 migration-output의 원본 소스(성경 사이트 등)에서 빠진 절을 채워 넣으면 된다.
//
// 사용법
//   cd supabase
//   node extract_book_verses.js <krv약자> <book_id> [장범위] [--out=파일명]
//
// 예시
//   node extract_book_verses.js act acts             # 사도행전 전체(1~28장)
//   node extract_book_verses.js act acts 23          # 사도행전 23장만
//   node extract_book_verses.js act acts 22-24        # 사도행전 22~24장
//   node extract_book_verses.js act acts 1-28 --out=acts_verses_full.json
//
// krv약자는 krv_full_bible.json의 책 키(gn, ex, ..., jo=요한복음, act=사도행전, re=요한계시록 등).
// book_id는 이 프로젝트의 Supabase verses.book_id 값(예: 'acts') — 마이그레이션 스크립트가
// 그대로 upsert에 쓸 값이니 원하는 값을 넣으면 된다.

'use strict';

const fs = require('fs');
const path = require('path');

const KRV_PATH = path.join(__dirname, 'reference-data', 'krv_full_bible.json');
const STANDARD_COUNTS_PATH = path.join(__dirname, 'reference-data', 'standard_verse_counts.json');
const OUTPUT_DIR = path.join(__dirname, 'migration-output');

function loadJson(p) {
  if (!fs.existsSync(p)) throw new Error(`파일을 찾을 수 없습니다: ${p}`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function parseChapterRange(rangeArg, availableChapters) {
  if (!rangeArg) return availableChapters;
  const m = /^(\d+)(?:-(\d+))?$/.exec(rangeArg);
  if (!m) throw new Error(`장 범위 형식이 올바르지 않습니다: "${rangeArg}" (예: "23" 또는 "22-24")`);
  const start = Number(m[1]);
  const end = m[2] ? Number(m[2]) : start;
  if (start > end) throw new Error(`장 범위가 거꾸로입니다: ${rangeArg}`);
  const chapters = [];
  for (let c = start; c <= end; c++) chapters.push(c);
  const missing = chapters.filter((c) => !availableChapters.includes(c));
  if (missing.length) throw new Error(`krv_full_bible.json에 없는 장입니다: ${missing.join(', ')}장`);
  return chapters;
}

// 실제 절 번호 집합을 1..기대절수와 비교해서, 몇 개가 모자란지뿐 아니라
// "몇 절이 구체적으로 비어있는지"까지 짚어준다 — 사도행전 23장처럼 끝이 아니라
// 중간 절이 통째로 빠지는 경우 개수만 봐서는 못 알아채기 때문.
function diagnoseChapter(actualVerseNumbers, expectedCount) {
  const actualSet = new Set(actualVerseNumbers);
  const actualMax = actualVerseNumbers.length ? Math.max(...actualVerseNumbers) : 0;
  const missing = [];
  for (let v = 1; v <= Math.max(expectedCount, actualMax); v++) {
    if (!actualSet.has(v)) missing.push(v);
  }
  return { actualCount: actualVerseNumbers.length, missing };
}

function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const outArg = process.argv.slice(2).find((a) => a.startsWith('--out='));
  const [krvKey, bookId, rangeArg] = args;

  if (!krvKey || !bookId) {
    console.error('사용법: node extract_book_verses.js <krv약자> <book_id> [장범위] [--out=파일명]');
    console.error('예시:   node extract_book_verses.js act acts 22-24');
    process.exit(1);
  }

  const krv = loadJson(KRV_PATH);
  const standard = loadJson(STANDARD_COUNTS_PATH);

  const book = krv.books[krvKey];
  if (!book) {
    throw new Error(`krv_full_bible.json에 "${krvKey}" 책이 없습니다. 사용 가능한 키: ${Object.keys(krv.books).join(', ')}`);
  }
  const standardCounts = standard.books[krvKey];
  if (!standardCounts) {
    throw new Error(`standard_verse_counts.json에 "${krvKey}"에 대한 표준 절수가 없습니다.`);
  }

  const availableChapters = Object.keys(book.chapters).map(Number).sort((a, b) => a - b);
  const chaptersToExtract = parseChapterRange(rangeArg, availableChapters);

  console.log(`${krvKey} 책에서 ${chaptersToExtract.length}개 장(${chaptersToExtract[0]}~${chaptersToExtract[chaptersToExtract.length - 1]}장) 추출 중...\n`);

  const rows = [];
  const warnings = [];

  chaptersToExtract.forEach((chapter) => {
    const verseObj = book.chapters[String(chapter)];
    const verseNumbers = Object.keys(verseObj).map(Number).sort((a, b) => a - b);
    const expectedCount = standardCounts[String(chapter)];

    if (expectedCount === undefined) {
      warnings.push(`  ⚠ ${chapter}장: 표준 절수 데이터가 없어 검증을 건너뜀 (실제 ${verseNumbers.length}절)`);
    } else if (verseNumbers.length !== expectedCount) {
      const { missing } = diagnoseChapter(verseNumbers, expectedCount);
      warnings.push(
        `  ⚠ ${chapter}장: 표준 절수 ${expectedCount}개인데 실제로는 ${verseNumbers.length}개 ` +
        `(빠진 절: ${missing.join(', ')}절)`
      );
    }

    verseNumbers.forEach((verse) => {
      rows.push({ chapter, verse, text: verseObj[String(verse)] });
    });
  });

  console.log(`추출 완료: ${rows.length}절\n`);

  if (warnings.length) {
    console.log('⚠ 절수 불일치 경고 — 실제 원문이 빠졌을 가능성이 있으니 확인 후 필요하면 직접 보정하세요:');
    warnings.forEach((w) => console.log(w));
    console.log('');
  } else {
    console.log('절수 검증 통과 — 모든 장이 표준 절수와 일치합니다.\n');
  }

  const rangeLabel = chaptersToExtract.length === 1
    ? String(chaptersToExtract[0])
    : `${chaptersToExtract[0]}to${chaptersToExtract[chaptersToExtract.length - 1]}`;
  const outPath = outArg
    ? path.join(OUTPUT_DIR, outArg.slice('--out='.length))
    : path.join(OUTPUT_DIR, `${bookId}_verses_${rangeLabel}.json`);

  fs.writeFileSync(outPath, JSON.stringify(rows, null, 2));
  console.log(`저장됨: ${path.relative(process.cwd(), outPath)}`);
}

main();
