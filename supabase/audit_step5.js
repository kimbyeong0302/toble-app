#!/usr/bin/env node
// STEP 5 — KRV 66권 최종 Audit
// INSERT 없음. 조회/검증만.
'use strict';

const fs   = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const STANDARD = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'reference-data/standard_verse_counts.json'), 'utf8'
));

// KRV 절수 체계상 존재하지 않는 3절 → missing 판단 제외
const KRV_VERSIFICATION_ABSENT = new Set([
  '1samuel|30|31',
  'psalms|72|20',
  '2corinthians|13|14',
]);

// 이번 보정 63절
const CORRECTED_63 = [
  {book:'judges',ch:9,v:57},
  {book:'1samuel',ch:7,v:17},{book:'1samuel',ch:17,v:58},
  {book:'1kings',ch:1,v:53},{book:'1kings',ch:22,v:53},
  {book:'1chronicles',ch:2,v:55},{book:'2chronicles',ch:7,v:22},
  {book:'esther',ch:4,v:15},{book:'esther',ch:4,v:16},{book:'esther',ch:4,v:17},
  {book:'psalms',ch:8,v:9},{book:'psalms',ch:16,v:10},{book:'psalms',ch:16,v:11},
  {book:'psalms',ch:36,v:12},{book:'psalms',ch:38,v:21},{book:'psalms',ch:38,v:22},
  {book:'psalms',ch:75,v:10},{book:'psalms',ch:80,v:19},
  {book:'psalms',ch:92,v:14},{book:'psalms',ch:92,v:15},{book:'psalms',ch:104,v:35},
  ...Array.from({length:20},(_,i)=>({book:'psalms',ch:118,v:10+i})),
  {book:'proverbs',ch:10,v:31},{book:'proverbs',ch:10,v:32},
  {book:'proverbs',ch:11,v:31},{book:'proverbs',ch:13,v:25},
  {book:'ecclesiastes',ch:5,v:20},
  {book:'isaiah',ch:13,v:22},{book:'isaiah',ch:32,v:20},
  {book:'isaiah',ch:37,v:37},{book:'isaiah',ch:37,v:38},
  {book:'jeremiah',ch:1,v:19},{book:'jeremiah',ch:51,v:64},{book:'jeremiah',ch:52,v:34},
  ...Array.from({length:9},(_,i)=>({book:'colossians',ch:4,v:10+i})),
  {book:'2timothy',ch:4,v:22},
];

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

async function main() {
  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(
    process.env.SUPABASE_URL || 'https://tepsuxyfyrkylyhsngwo.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  let totalExpectedChapters = 0, totalActualChapters = 0;
  let totalExpectedVerses   = 0, totalActualVerses   = 0;

  const allMissing   = [];  // 진짜 missing (KRV 절수 차이 제외)
  const allExtra     = [];  // 표준 밖 verse 번호
  const allDupes     = [];  // duplicate (book,trans,ch,v)
  const allNullText  = [];
  const allEmptyText = [];
  const bookFails    = [];  // 책 단위 불일치

  // ── 책별 전체 데이터 가져오기 ──
  process.stdout.write('책별 조회 중 ');
  for (const [krvKey, bookId] of KEY_MAP) {
    const stdChapters = STANDARD.books[krvKey];
    if (!stdChapters) continue;

    const expChaps = Object.keys(stdChapters).length;
    totalExpectedChapters += expChaps;

    let expVerses = 0;
    for (const cnt of Object.values(stdChapters)) expVerses += cnt;
    // KRV 절수 차이 3절 반영: 해당 책의 기대 절수에서 차감
    for (const absent of KRV_VERSIFICATION_ABSENT) {
      const [ab, , ] = absent.split('|');
      if (ab === bookId) expVerses--;
    }
    totalExpectedVerses += expVerses;

    // Supabase에서 해당 책 전체 verses 가져오기 (페이징)
    let allRows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from('verses')
        .select('chapter, verse, text')
        .eq('book_id', bookId).eq('translation_id', 'krv')
        .order('chapter').order('verse')
        .range(from, from + 999);
      if (error) { console.error(`\n${bookId} 조회 실패: ${error.message}`); break; }
      if (!data || data.length === 0) break;
      allRows = allRows.concat(data);
      if (data.length < 1000) break;
    }

    totalActualVerses += allRows.length;

    // duplicate 검사 (verse 단위)
    const vSeen = new Set();
    for (const r of allRows) {
      const k = `${r.chapter}|${r.verse}`;
      if (vSeen.has(k)) allDupes.push(`${bookId} ${r.chapter}:${r.verse}`);
      vSeen.add(k);
    }

    // null / empty text
    for (const r of allRows) {
      const lbl = `${bookId} ${r.chapter}:${r.verse}`;
      if (r.text === null || r.text === undefined) allNullText.push(lbl);
      else if (r.text.trim() === '') allEmptyText.push(lbl);
    }

    // 장별 verse 수 검사
    const byChap = {};
    allRows.forEach(r => {
      if (!byChap[r.chapter]) byChap[r.chapter] = [];
      byChap[r.chapter].push(r.verse);
    });

    let bookMissing = 0, bookExtra = 0;
    const actChapsSet = new Set(Object.keys(byChap).map(Number));
    totalActualChapters += actChapsSet.size;

    for (const [chStr, expCnt] of Object.entries(stdChapters)) {
      const ch = Number(chStr);
      const actVerses = (byChap[ch] || []).slice().sort((a,b)=>a-b);
      const actSet = new Set(actVerses);
      const actMax = actVerses.length ? Math.max(...actVerses) : 0;

      for (let v = 1; v <= Math.max(expCnt, actMax); v++) {
        const absentKey = `${bookId}|${ch}|${v}`;
        if (!actSet.has(v) && v <= expCnt) {
          // KRV 절수 차이인 경우 skip
          if (!KRV_VERSIFICATION_ABSENT.has(absentKey)) {
            allMissing.push(`${bookId} ${ch}:${v}`);
            bookMissing++;
          }
        }
        if (actSet.has(v) && v > expCnt) {
          allExtra.push(`${bookId} ${ch}:${v}`);
          bookExtra++;
        }
      }
    }

    if (bookMissing > 0 || bookExtra > 0) {
      bookFails.push({ bookId, bookMissing, bookExtra });
    }

    process.stdout.write('.');
  }
  console.log(' 완료\n');

  // ── 검증 7: 이번 보정 63절 ──
  const correctedSet = new Set(CORRECTED_63.map(e=>`${e.book}|${e.ch}|${e.v}`));
  let correctedOk = 0;
  const correctedFail = [];

  const correctedByBook = {};
  for (const e of CORRECTED_63) {
    if (!correctedByBook[e.book]) correctedByBook[e.book] = [];
    correctedByBook[e.book].push(e);
  }
  for (const [bk, bv] of Object.entries(correctedByBook)) {
    const chapters = [...new Set(bv.map(e=>e.ch))];
    for (const ch of chapters) {
      const chv = bv.filter(e=>e.ch===ch);
      const { data, error } = await sb.from('verses')
        .select('chapter,verse,text')
        .eq('book_id',bk).eq('translation_id','krv')
        .eq('chapter',ch).in('verse',chv.map(e=>e.v));
      if (error) { correctedFail.push(`${bk} ${ch}장 조회실패`); continue; }
      const got = new Set((data||[]).map(r=>r.verse));
      for (const t of chv) {
        if (got.has(t.v)) correctedOk++;
        else correctedFail.push(`${bk} ${t.ch}:${t.v} 미존재`);
      }
    }
  }

  // ── 검증 8: 절수 차이 3절이 없는지 ──
  const absentConfirm = [];
  for (const key of KRV_VERSIFICATION_ABSENT) {
    const [bookId, ch, v] = key.split('|');
    const { data } = await sb.from('verses')
      .select('verse').eq('book_id',bookId).eq('translation_id','krv')
      .eq('chapter',Number(ch)).eq('verse',Number(v));
    if (data && data.length > 0) {
      absentConfirm.push(`${bookId} ${ch}:${v} — 있어서는 안 되는데 존재함`);
    }
  }

  // ── 최종 출력 ──
  const totalMissing = allMissing.length;
  const totalDupes   = allDupes.length;
  const totalNull    = allNullText.length;
  const totalEmpty   = allEmptyText.length;
  const totalExtra   = allExtra.length;
  const allOk = totalMissing===0 && totalDupes===0 && totalNull===0 &&
                totalEmpty===0 && correctedFail.length===0 && absentConfirm.length===0;

  console.log('================================');
  console.log('TOBLE KRV 66권 최종 Audit');
  console.log('================================');
  console.log(`Books:               66`);
  console.log(`Expected chapters:   ${totalExpectedChapters}`);
  console.log(`Actual chapters:     ${totalActualChapters}`);
  console.log(`Expected verses:     ${totalExpectedVerses}  (KRV 절수 차이 3절 제외)`);
  console.log(`Actual verses:       ${totalActualVerses}`);
  console.log(`Missing verses:      ${totalMissing}`);
  console.log(`Extra verses:        ${totalExtra}  (표준 밖 번호)`);
  console.log(`Duplicate verses:    ${totalDupes}`);
  console.log(`NULL text:           ${totalNull}`);
  console.log(`Empty text:          ${totalEmpty}`);
  console.log(`이번 보정 63절:      ${correctedOk} / 63`);
  console.log(`KRV 절수 차이:       3  (absent 정상 확인: ${absentConfirm.length===0?'OK':'이상'})`);

  const finalMismatch = totalMissing + totalDupes + totalNull + totalEmpty +
                        correctedFail.length + absentConfirm.length;
  console.log(`최종 불일치:         ${finalMismatch}`);
  console.log('================================');

  if (bookFails.length > 0) {
    console.log('\n[책별 불일치 상세]');
    bookFails.forEach(b =>
      console.log(`  ${b.bookId}: missing=${b.bookMissing} extra=${b.bookExtra}`)
    );
  }
  if (allMissing.length > 0) {
    console.log('\n[Missing verse 목록]');
    allMissing.forEach(m => console.log('  ' + m));
  }
  if (allExtra.length > 0) {
    console.log('\n[Extra verse 목록 (표준 범위 초과)]');
    allExtra.forEach(e => console.log('  ' + e));
  }
  if (allDupes.length > 0) {
    console.log('\n[Duplicate 목록]');
    allDupes.forEach(d => console.log('  ' + d));
  }
  if (allNullText.length > 0) {
    console.log('\n[NULL text 목록]');
    allNullText.forEach(n => console.log('  ' + n));
  }
  if (allEmptyText.length > 0) {
    console.log('\n[Empty text 목록]');
    allEmptyText.forEach(e => console.log('  ' + e));
  }
  if (correctedFail.length > 0) {
    console.log('\n[보정 63절 검증 실패]');
    correctedFail.forEach(f => console.log('  ' + f));
  }
  if (absentConfirm.length > 0) {
    console.log('\n[절수 차이 3절 이상 (있어서는 안 됨)]');
    absentConfirm.forEach(a => console.log('  ' + a));
  }

  console.log('');
  console.log(allOk
    ? 'FINAL AUDIT PASS — 커밋 가능'
    : 'FINAL AUDIT FAIL — 커밋 금지');
}

main().catch(e => { console.error('실패:', e.message); process.exit(1); });
