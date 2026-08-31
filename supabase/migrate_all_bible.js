#!/usr/bin/env node
// 남은 성경 책 전체(구·신약 66권 중 아직 안 올린 책들)를 Supabase에 대량 삽입.
// - books 테이블에 available=true로 upsert
// - verses 테이블에 HTML 엔티티(&#x27; 등) 디코딩해서 batch insert
// - 이미 절이 있는 책은 (일부라도) 건너뜀(재실행 안전)
//
// 사용법:
//   node migrate_all_bible.js --dry-run
//   node migrate_all_bible.js
//   node migrate_all_bible.js --only=genesis,psalms   (특정 책만)

'use strict';

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const DRY_RUN = process.argv.includes('--dry-run');
const ONLY_ARG = process.argv.find(a => a.startsWith('--only='));
const ONLY = ONLY_ARG ? ONLY_ARG.slice(7).split(',') : null;

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tepsuxyfyrkylyhsngwo.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_ROLE_KEY) { console.error('SUPABASE_SERVICE_ROLE_KEY 없음'); process.exit(1); }

// 원본 JSON key -> 앱 book_id, name_ko, order_num, testament 매핑.
// 순서는 개신교 정경 순서 그대로.
const BOOK_MAP = [
  ['gn',   'genesis',         '창세기',        1, 'old'],
  ['ex',   'exodus',          '출애굽기',      2, 'old'],
  ['lv',   'leviticus',       '레위기',        3, 'old'],
  ['nm',   'numbers',         '민수기',        4, 'old'],
  ['dt',   'deuteronomy',     '신명기',        5, 'old'],
  ['js',   'joshua',          '여호수아',      6, 'old'],
  ['jud',  'judges',          '사사기',        7, 'old'],
  ['rt',   'ruth',            '룻기',          8, 'old'],
  ['1sm',  '1samuel',         '사무엘상',      9, 'old'],
  ['2sm',  '2samuel',         '사무엘하',     10, 'old'],
  ['1kgs', '1kings',          '열왕기상',     11, 'old'],
  ['2kgs', '2kings',          '열왕기하',     12, 'old'],
  ['1ch',  '1chronicles',     '역대상',       13, 'old'],
  ['2ch',  '2chronicles',     '역대하',       14, 'old'],
  ['ezr',  'ezra',            '에스라',       15, 'old'],
  ['ne',   'nehemiah',        '느헤미야',     16, 'old'],
  ['et',   'esther',          '에스더',       17, 'old'],
  ['job',  'job',             '욥기',         18, 'old'],
  ['ps',   'psalms',          '시편',         19, 'old'],
  ['prv',  'proverbs',        '잠언',         20, 'old'],
  ['ec',   'ecclesiastes',    '전도서',       21, 'old'],
  ['so',   'songofsongs',     '아가',         22, 'old'],
  ['is',   'isaiah',          '이사야',       23, 'old'],
  ['jr',   'jeremiah',        '예레미야',     24, 'old'],
  ['lm',   'lamentations',    '예레미야애가', 25, 'old'],
  ['ez',   'ezekiel',         '에스겔',       26, 'old'],
  ['dn',   'daniel',          '다니엘',       27, 'old'],
  ['ho',   'hosea',           '호세아',       28, 'old'],
  ['jl',   'joel',            '요엘',         29, 'old'],
  ['am',   'amos',            '아모스',       30, 'old'],
  ['ob',   'obadiah',         '오바댜',       31, 'old'],
  ['jn',   'jonah',           '요나',         32, 'old'],
  ['mi',   'micah',           '미가',         33, 'old'],
  ['na',   'nahum',           '나훔',         34, 'old'],
  ['hk',   'habakkuk',        '하박국',       35, 'old'],
  ['zp',   'zephaniah',       '스바냐',       36, 'old'],
  ['hg',   'haggai',          '학개',         37, 'old'],
  ['zc',   'zechariah',       '스가랴',       38, 'old'],
  ['ml',   'malachi',         '말라기',       39, 'old'],
  ['mt',   'matthew',         '마태복음',     40, 'new'],
  ['mk',   'mark',            '마가복음',     41, 'new'],
  ['lk',   'luke',            '누가복음',     42, 'new'],
  ['jo',   'john',            '요한복음',     43, 'new'],
  ['act',  'acts',            '사도행전',     44, 'new'],
  ['rm',   'romans',          '로마서',       45, 'new'],
  ['1co',  '1corinthians',    '고린도전서',   46, 'new'],
  ['2co',  '2corinthians',    '고린도후서',   47, 'new'],
  ['gl',   'galatians',       '갈라디아서',   48, 'new'],
  ['eph',  'ephesians',       '에베소서',     49, 'new'],
  ['ph',   'philippians',     '빌립보서',     50, 'new'],
  ['cl',   'colossians',      '골로새서',     51, 'new'],
  ['1ts',  '1thessalonians',  '데살로니가전서', 52, 'new'],
  ['2ts',  '2thessalonians',  '데살로니가후서', 53, 'new'],
  ['1tm',  '1timothy',        '디모데전서',   54, 'new'],
  ['2tm',  '2timothy',        '디모데후서',   55, 'new'],
  ['tt',   'titus',           '디도서',       56, 'new'],
  ['phm',  'philemon',        '빌레몬서',     57, 'new'],
  ['hb',   'hebrews',         '히브리서',     58, 'new'],
  ['jm',   'james',           '야고보서',     59, 'new'],
  ['1pe',  '1peter',          '베드로전서',   60, 'new'],
  ['2pe',  '2peter',          '베드로후서',   61, 'new'],
  ['1jo',  '1john',           '요한일서',     62, 'new'],
  ['2jo',  '2john',           '요한이서',     63, 'new'],
  ['3jo',  '3john',           '요한삼서',     64, 'new'],
  ['jd',   'jude',            '유다서',       65, 'new'],
  ['re',   'revelation',      '요한계시록',   66, 'new'],
];

// 표준 HTML 엔티티 → 실제 문자
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#([0-9]+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, n) => NAMED[n] != null ? NAMED[n] : m);
}

async function main() {
  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const src = JSON.parse(fs.readFileSync(path.join(__dirname, 'reference-data/krv_full_bible.json'), 'utf8'));

  console.log('=== Bible full migration ===');

  // 이미 있는 verses 카운트로 어떤 책이 이미 채워졌는지 확인
  const bookIds = BOOK_MAP.map(r => r[1]);
  const filter = ONLY ? bookIds.filter(id => ONLY.includes(id)) : bookIds;
  console.log(`대상 책 ${filter.length}개 (전체 ${bookIds.length}권 중)`);

  const alreadyCount = {};
  for (const bid of filter) {
    // count 쿼리
    const { count } = await sb.from('verses')
      .select('id', { count: 'exact', head: true })
      .eq('book_id', bid).eq('translation_id', 'krv');
    alreadyCount[bid] = count || 0;
  }

  // 각 책별 계획 요약
  console.log('\n== 계획 요약 ==');
  const plan = [];
  for (const [srcKey, id, nameKo, orderNum, testament] of BOOK_MAP) {
    if (!filter.includes(id)) continue;
    const bookSrc = src.books[srcKey];
    if (!bookSrc) { console.log(`  ${id}: 원본 JSON에 ${srcKey} 없음 — 건너뜀`); continue; }
    const ch = bookSrc.chapters || {};
    const chapterCount = Object.keys(ch).length;
    let verseCount = 0;
    for (const c of Object.values(ch)) verseCount += Object.keys(c).length;
    const existing = alreadyCount[id];
    const status = existing === 0 ? '신규' : existing >= verseCount ? '완전 채워짐' : `부분(${existing}/${verseCount})`;
    plan.push({ id, srcKey, nameKo, orderNum, testament, chapterCount, verseCount, existing, status });
    console.log(`  ${String(orderNum).padStart(2)} ${id.padEnd(16)} ${nameKo.padEnd(8)} 장${String(chapterCount).padStart(3)} 절${String(verseCount).padStart(4)}  → ${status}`);
  }

  const toMigrate = plan.filter(p => p.existing < p.verseCount);
  const totalNewVerses = toMigrate.reduce((s, p) => s + (p.verseCount - p.existing), 0);
  console.log(`\n실제 삽입 대상: ${toMigrate.length}권, 신규 절 ${totalNewVerses}개`);

  if (DRY_RUN) { console.log('\n--dry-run: 여기까지만.'); return; }

  // 1) books upsert
  console.log('\n== books upsert ==');
  const bookRows = plan.map(p => ({
    id: p.id,
    name_ko: p.nameKo,
    testament: p.testament,
    order_num: p.orderNum,
    chapter_count: p.chapterCount,
    available: true,
  }));
  const { error: bErr } = await sb.from('books').upsert(bookRows, { onConflict: 'id' });
  if (bErr) throw new Error('books upsert 실패: ' + bErr.message);
  console.log(`  books ${bookRows.length}행 upsert 완료`);

  // 2) verses batch insert (책이 부분 채워졌으면 그 책은 통째로 지우고 다시 넣는다 —
  // 부분 상태에서 어떤 절이 빠졌는지 정확히 알기 애매하고, KRV는 앞으로 안 바뀔 자료라서 안전)
  console.log('\n== verses 삽입 ==');
  for (const p of toMigrate) {
    const bookSrc = src.books[p.srcKey];
    const ch = bookSrc.chapters;
    const rows = [];
    for (const [cStr, verses] of Object.entries(ch)) {
      const c = parseInt(cStr, 10);
      for (const [vStr, text] of Object.entries(verses)) {
        const v = parseInt(vStr, 10);
        rows.push({
          book_id: p.id, translation_id: 'krv',
          chapter: c, verse: v,
          text: decodeEntities(text),
        });
      }
    }
    if (p.existing > 0) {
      const { error: delErr } = await sb.from('verses').delete().eq('book_id', p.id).eq('translation_id', 'krv');
      if (delErr) throw new Error(`${p.id} 기존 verses 삭제 실패: ${delErr.message}`);
      console.log(`  ${p.id}: 부분 채워진 ${p.existing}개 삭제 후 재삽입`);
    }
    // 500행씩 batch insert
    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH);
      const { error } = await sb.from('verses').insert(slice);
      if (error) throw new Error(`${p.id} 절 insert 실패(${i}~${i+slice.length}): ${error.message}`);
    }
    console.log(`  ${p.id.padEnd(16)} ${p.nameKo.padEnd(8)} ${rows.length}절 완료`);
  }

  console.log('\n완료.');
}

main().catch(e => { console.error('\n실패:', e.message); process.exit(1); });
