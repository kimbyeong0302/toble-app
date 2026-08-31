#!/usr/bin/env node
// 두 가지를 한 번에 처리:
//   1) 사도행전 절 텍스트에 남아 있는 HTML 엔티티(&#x27; 등)를 실제 문자로 디코딩해
//      Supabase verses 테이블을 갱신. 갱신 후 원본 KRV JSON을 동일하게 디코딩한
//      텍스트와 절 단위로 비교해 일치하는지 확인한다.
//   2) 사도행전·로마서 book_extras.context_html을 새로 재편성한 HTML 파일로 교체
//      ("[보완]" 라벨 제거·주제별로 카드 합쳐 새로 씀). map_locations·people은 안 건드림.
//
// 사용법(supabase/ 안에서):
//   node fix_acts_romans.js --dry-run
//   node fix_acts_romans.js

'use strict';

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const DRY_RUN = process.argv.includes('--dry-run');
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tepsuxyfyrkylyhsngwo.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_ROLE_KEY) { console.error('SUPABASE_SERVICE_ROLE_KEY 없음'); process.exit(1); }

const NEW_BG_DIR = process.env.NEW_BG_DIR;
if (!NEW_BG_DIR) { console.error('NEW_BG_DIR 환경변수로 새 배경 HTML 폴더 경로 지정'); process.exit(1); }

// 표준 HTML 엔티티 → 실제 문자
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#([0-9]+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, n) => NAMED[n] != null ? NAMED[n] : m);
}

async function main() {
  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // ── 1) Acts verses 엔티티 디코딩 ─────────────────────────────
  console.log('\n[1/3] Acts verses 엔티티 디코딩 + 원본과 대조');
  const src = JSON.parse(fs.readFileSync(path.join(__dirname, 'reference-data/krv_full_bible.json'), 'utf8'));
  const actsSrc = src.books.act.chapters; // { "1": { "1": "text", ... }, ... }

  let allVerses = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('verses')
      .select('chapter, verse, text')
      .eq('book_id', 'acts').eq('translation_id', 'krv')
      .order('chapter').order('verse').range(from, from + 999);
    if (error) throw new Error('verses 조회 실패: ' + error.message);
    if (!data || data.length === 0) break;
    allVerses = allVerses.concat(data);
    if (data.length < 1000) break;
  }
  console.log(`  Acts 절 ${allVerses.length}개 조회`);

  const toUpdate = [];
  const mismatches = [];
  let unchanged = 0;
  for (const row of allVerses) {
    const decoded = decodeEntities(row.text);
    const srcRaw = actsSrc[String(row.chapter)] && actsSrc[String(row.chapter)][String(row.verse)];
    const srcDecoded = srcRaw != null ? decodeEntities(srcRaw) : null;
    if (decoded === row.text) { unchanged++; continue; }
    // 디코딩 결과가 원본(디코딩본)과 다르면 기록 — 원본 대조 실패
    if (srcDecoded != null && srcDecoded !== decoded) {
      mismatches.push({ ref: row.chapter + ':' + row.verse, decoded: decoded.slice(0, 60), src: srcDecoded.slice(0, 60) });
    }
    toUpdate.push({ chapter: row.chapter, verse: row.verse, text: decoded });
  }
  console.log(`  디코딩 필요: ${toUpdate.length}개, 그대로: ${unchanged}개`);
  console.log(`  원본(KRV JSON)과 불일치: ${mismatches.length}개`);
  if (mismatches.length) mismatches.slice(0, 5).forEach(m => console.log(`    - ${m.ref}\n      DB→ ${m.decoded}\n      원본→ ${m.src}`));

  // ── 2) 새 context_html 준비 ─────────────────────────────
  console.log('\n[2/3] 새 배경 context_html 준비');
  const newActs = fs.readFileSync(path.join(NEW_BG_DIR, 'acts_bg_new.html'), 'utf8').trim();
  const newRomans = fs.readFileSync(path.join(NEW_BG_DIR, 'romans_bg_new.html'), 'utf8').trim();
  console.log(`  acts_bg_new.html   ${newActs.length}자, 카드 ${(newActs.match(/class="card"/g)||[]).length}개, [보완] 잔재 ${(newActs.match(/\[보완\]/g)||[]).length}건`);
  console.log(`  romans_bg_new.html ${newRomans.length}자, 카드 ${(newRomans.match(/class="card"/g)||[]).length}개, [보완] 잔재 ${(newRomans.match(/\[보완\]/g)||[]).length}건`);

  if (DRY_RUN) { console.log('\n--dry-run: 여기까지만.'); return; }

  // ── 3) 실제 반영 ─────────────────────────────
  console.log('\n[3/3] Supabase에 반영');
  // 3a) verses 개별 update (upsert도 가능하지만 book_id/translation_id/chapter/verse 조합 키로 update가 안전)
  let done = 0;
  for (const row of toUpdate) {
    const { error } = await sb.from('verses')
      .update({ text: row.text })
      .eq('book_id', 'acts').eq('translation_id', 'krv')
      .eq('chapter', row.chapter).eq('verse', row.verse);
    if (error) throw new Error(`verses update 실패 ${row.chapter}:${row.verse}: ${error.message}`);
    done++;
    if (done % 50 === 0) console.log(`  verses update ${done}/${toUpdate.length}`);
  }
  console.log(`  verses update 완료: ${done}개`);

  // 3b) book_extras.context_html 교체(update, map_locations·people은 그대로)
  for (const [bid, html] of [['acts', newActs], ['romans', newRomans]]) {
    const { error, data } = await sb.from('book_extras')
      .update({ context_html: html })
      .eq('book_id', bid)
      .select('book_id');
    if (error) throw new Error(`book_extras(${bid}) update 실패: ${error.message}`);
    if (!data || data.length === 0) throw new Error(`book_extras ${bid} 행 없음`);
    console.log(`  book_extras.context_html(${bid}) 교체 완료`);
  }

  console.log('\n완료.');
}

main().catch((e) => { console.error('\n실패:', e.message); process.exit(1); });
