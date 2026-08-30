#!/usr/bin/env node
// extract_book_verses.js의 diagnoseChapter 로직을 66권 전체에 대해 돌린다.
// - Supabase verses 테이블(실제 앱이 쓰는 데이터)
// - 원본 krv_full_bible.json
// 각각을 standard_verse_counts.json과 대조해 절수/빠진 절 번호를 보고한다.

'use strict';

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const KRV = JSON.parse(fs.readFileSync(path.join(__dirname, 'reference-data', 'krv_full_bible.json'), 'utf8'));
const STANDARD = JSON.parse(fs.readFileSync(path.join(__dirname, 'reference-data', 'standard_verse_counts.json'), 'utf8'));

// KRV JSON 키(gn 등) ↔ Supabase book_id(genesis 등)
const KEY_MAP = [
  ['gn','genesis'],['ex','exodus'],['lv','leviticus'],['nm','numbers'],['dt','deuteronomy'],
  ['js','joshua'],['jud','judges'],['rt','ruth'],['1sm','1samuel'],['2sm','2samuel'],
  ['1kgs','1kings'],['2kgs','2kings'],['1ch','1chronicles'],['2ch','2chronicles'],
  ['ezr','ezra'],['ne','nehemiah'],['et','esther'],['job','job'],['ps','psalms'],
  ['prv','proverbs'],['ec','ecclesiastes'],['so','songofsongs'],['is','isaiah'],
  ['jr','jeremiah'],['lm','lamentations'],['ez','ezekiel'],['dn','daniel'],
  ['ho','hosea'],['jl','joel'],['am','amos'],['ob','obadiah'],['jn','jonah'],
  ['mi','micah'],['na','nahum'],['hk','habakkuk'],['zp','zephaniah'],['hg','haggai'],
  ['zc','zechariah'],['ml','malachi'],
  ['mt','matthew'],['mk','mark'],['lk','luke'],['jo','john'],['act','acts'],['rm','romans'],
  ['1co','1corinthians'],['2co','2corinthians'],['gl','galatians'],['eph','ephesians'],
  ['ph','philippians'],['cl','colossians'],['1ts','1thessalonians'],['2ts','2thessalonians'],
  ['1tm','1timothy'],['2tm','2timothy'],['tt','titus'],['phm','philemon'],
  ['hb','hebrews'],['jm','james'],['1pe','1peter'],['2pe','2peter'],
  ['1jo','1john'],['2jo','2john'],['3jo','3john'],['jd','jude'],['re','revelation'],
];

function diagnoseChapter(actualVerseNumbers, expectedCount) {
  const actualSet = new Set(actualVerseNumbers);
  const actualMax = actualVerseNumbers.length ? Math.max(...actualVerseNumbers) : 0;
  const missing = [];
  const extra = [];
  for (let v = 1; v <= Math.max(expectedCount, actualMax); v++) {
    if (!actualSet.has(v) && v <= expectedCount) missing.push(v);
    if (actualSet.has(v) && v > expectedCount) extra.push(v);
  }
  return { actualCount: actualVerseNumbers.length, missing, extra };
}

async function main() {
  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(
    process.env.SUPABASE_URL || 'https://tepsuxyfyrkylyhsngwo.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const dbMismatches = []; // Supabase vs standard
  const jsonMismatches = []; // JSON vs standard

  for (const [krvKey, bookId] of KEY_MAP) {
    // 표준 절수
    const stdChapters = STANDARD.books[krvKey];
    if (!stdChapters) {
      console.log(`SKIP ${bookId}: 표준 절수 데이터 없음`);
      continue;
    }

    // 원본 JSON 검증
    const srcBook = KRV.books[krvKey];
    if (!srcBook) {
      console.log(`SKIP ${bookId}: 원본 JSON 없음`);
      continue;
    }
    for (const [chStr, expected] of Object.entries(stdChapters)) {
      const chapter = Number(chStr);
      const srcChapter = srcBook.chapters[String(chapter)] || {};
      const srcVerses = Object.keys(srcChapter).map(Number).sort((a,b)=>a-b);
      const srcDiag = diagnoseChapter(srcVerses, expected);
      if (srcVerses.length !== expected || srcDiag.extra.length > 0) {
        jsonMismatches.push({
          book: bookId, chapter, expected,
          actual: srcVerses.length,
          missing: srcDiag.missing,
          extra: srcDiag.extra,
        });
      }
    }

    // Supabase 검증
    let allVerses = [];
    for (let from=0;;from+=1000) {
      const { data, error } = await sb.from('verses')
        .select('chapter, verse')
        .eq('book_id', bookId).eq('translation_id', 'krv')
        .order('chapter').order('verse')
        .range(from, from+999);
      if (error) throw new Error(`${bookId} 조회 실패: ${error.message}`);
      if (!data || data.length === 0) break;
      allVerses = allVerses.concat(data);
      if (data.length < 1000) break;
    }
    const byChapter = {};
    allVerses.forEach(r => {
      if (!byChapter[r.chapter]) byChapter[r.chapter] = [];
      byChapter[r.chapter].push(r.verse);
    });
    for (const [chStr, expected] of Object.entries(stdChapters)) {
      const chapter = Number(chStr);
      const dbVerses = (byChapter[chapter] || []).slice().sort((a,b)=>a-b);
      const dbDiag = diagnoseChapter(dbVerses, expected);
      if (dbVerses.length !== expected || dbDiag.extra.length > 0) {
        dbMismatches.push({
          book: bookId, chapter, expected,
          actual: dbVerses.length,
          missing: dbDiag.missing,
          extra: dbDiag.extra,
        });
      }
    }
  }

  const format = (m) => `  ${m.book.padEnd(15)} ${String(m.chapter).padStart(3)}장  표준 ${m.expected}절 / 실제 ${m.actual}절`
    + (m.missing.length ? `  빠진 절: ${m.missing.join(', ')}` : '')
    + (m.extra.length ? `  추가 절(표준 밖): ${m.extra.join(', ')}` : '');

  console.log('\n═══════════════════════════════════════');
  console.log(' Supabase verses vs standard_verse_counts');
  console.log('═══════════════════════════════════════');
  if (dbMismatches.length === 0) {
    console.log('  ✅ 66권 전체 모든 장이 표준 절수와 정확히 일치.');
  } else {
    console.log(`  ⚠ ${dbMismatches.length}개 장에서 불일치 발견:\n`);
    dbMismatches.forEach(m => console.log(format(m)));
  }

  console.log('\n═══════════════════════════════════════');
  console.log(' krv_full_bible.json vs standard (참고용)');
  console.log('═══════════════════════════════════════');
  if (jsonMismatches.length === 0) {
    console.log('  ✅ 원본 JSON도 66권 전체 표준 절수 일치.');
  } else {
    console.log(`  ⚠ ${jsonMismatches.length}개 장에서 불일치:\n`);
    jsonMismatches.forEach(m => console.log(format(m)));
  }

  // 차이 요약: DB와 JSON 둘 다 불일치인지, DB만인지
  const jsonKey = m => `${m.book}|${m.chapter}`;
  const jsonSet = new Set(jsonMismatches.map(jsonKey));
  const dbOnlyMismatches = dbMismatches.filter(m => !jsonSet.has(jsonKey(m)));

  console.log('\n═══════════════════════════════════════');
  console.log(' 요약');
  console.log('═══════════════════════════════════════');
  console.log(`  Supabase 불일치: ${dbMismatches.length}장`);
  console.log(`  원본 JSON 불일치: ${jsonMismatches.length}장`);
  console.log(`  → 마이그레이션 자체 손실(DB에만 있는 불일치): ${dbOnlyMismatches.length}장`);
  if (dbOnlyMismatches.length) {
    console.log('    (마이그레이션 중 사라진 절 — 재삽입 필요)');
    dbOnlyMismatches.forEach(m => console.log(format(m)));
  } else {
    console.log('    → Supabase 불일치는 전부 원본 JSON에 이미 있던 것.');
  }
}

main().catch(e => { console.error('실패:', e.message); process.exit(1); });
