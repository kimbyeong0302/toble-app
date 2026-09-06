#!/usr/bin/env node
// 7권 vs 전체 인물·배경 밀도 비교 감사 스크립트
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const ALL_BOOKS = [
  'genesis','exodus','leviticus','numbers','deuteronomy',
  'joshua','judges','ruth','1samuel','2samuel','1kings','2kings',
  '1chronicles','2chronicles','ezra','nehemiah','esther',
  'job','psalms','proverbs','ecclesiastes','songofsongs',
  'isaiah','jeremiah','lamentations','ezekiel','daniel',
  'hosea','joel','amos','obadiah','jonah','micah','nahum',
  'habakkuk','zephaniah','haggai','zechariah','malachi',
  'matthew','mark','luke','john','acts',
  'romans','1corinthians','2corinthians','galatians','ephesians',
  'philippians','colossians','1thessalonians','2thessalonians',
  '1timothy','2timothy','titus','philemon','hebrews',
  'james','1peter','2peter','1john','2john','3john','jude','revelation'
];

const TARGET = ['ruth','matthew','mark','luke','john','acts','romans'];

async function main() {
  // 배경 데이터 조회
  const { data: extras } = await sb.from('book_extras').select('book_id, context_html');
  const extrasMap = {};
  (extras || []).forEach(r => { extrasMap[r.book_id] = r.context_html || ''; });

  // 인물 데이터 조회
  const { data: people } = await sb.from('people').select('book_id, name, role, body, character_profile');
  const peopleMap = {};
  (people || []).forEach(r => {
    if (!peopleMap[r.book_id]) peopleMap[r.book_id] = [];
    peopleMap[r.book_id].push(r);
  });

  // 통계 계산
  const stats = ALL_BOOKS.map(id => {
    const html = extrasMap[id] || '';
    const persons = peopleMap[id] || [];
    const cards = (html.match(/<div class="card">/g) || []).length;
    const hasTimeline = html.includes('timeline');
    const hasNoteSrc = html.includes('note-src');
    const avgBodyLen = persons.length
      ? Math.round(persons.reduce((s, p) => s + (p.body || '').length, 0) / persons.length)
      : 0;
    const cpCount = persons.filter(p => p.character_profile && Object.keys(p.character_profile).length > 0).length;
    return { id, htmlLen: html.length, cards, hasTimeline, hasNoteSrc, peopleCount: persons.length, avgBodyLen, cpCount, persons };
  });

  // 전체 평균 (0 제외)
  const withHtml = stats.filter(s => s.htmlLen > 0);
  const avgHtml = Math.round(withHtml.reduce((a, s) => a + s.htmlLen, 0) / withHtml.length);
  const withPeople = stats.filter(s => s.peopleCount > 0);
  const avgPeople = (withPeople.reduce((a, s) => a + s.peopleCount, 0) / withPeople.length).toFixed(1);
  const avgBody = Math.round(withPeople.reduce((a, s) => a + s.avgBodyLen, 0) / withPeople.length);

  console.log('=== 전체 평균 ===');
  console.log(`배경 HTML 평균: ${avgHtml}자 | 인물 평균: ${avgPeople}명 | 인물 body 평균: ${avgBody}자`);

  console.log('\n=== 7권 상세 ===');
  TARGET.forEach(id => {
    const s = stats.find(x => x.id === id);
    console.log(`\n[${id}]`);
    console.log(`  배경: ${s.htmlLen}자 / 카드: ${s.cards} / timeline: ${s.hasTimeline} / note-src: ${s.hasNoteSrc}`);
    console.log(`  인물: ${s.peopleCount}명 / avgBody: ${s.avgBodyLen}자 / cp: ${s.cpCount}명`);
    s.persons.forEach(p => {
      const cpKeys = p.character_profile ? Object.keys(p.character_profile) : [];
      console.log(`    - ${p.name} | role: ${(p.role||'').slice(0,30)} | body: ${(p.body||'').length}자 | cp: [${cpKeys.join(',')}]`);
    });
  });

  console.log('\n=== 전체 현황 (배경 HTML 기준) ===');
  stats.sort((a, b) => b.htmlLen - a.htmlLen).forEach(s => {
    const flag = TARGET.includes(s.id) ? '★' : ' ';
    console.log(`${flag} ${s.id.padEnd(20)} html:${String(s.htmlLen).padStart(6)}자 | 인물:${s.peopleCount}명 | avgBody:${String(s.avgBodyLen).padStart(4)}자 | cp:${s.cpCount}`);
  });

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
