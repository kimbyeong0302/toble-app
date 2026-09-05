#!/usr/bin/env node
// toble_nt_background_1cor_to_revelation_v4.json 을 읽어
// 각 책마다 book_extras.context_html 형식의 HTML 파일과
// map_locations.json 파일을 migration-output/ 에 생성한다.
//
// 사용법
//   cd supabase
//   node gen_nt_context_html.js               -- 21권 전체
//   node gen_nt_context_html.js --book=1cor   -- 단일 책만
//
// 생성 파일 (book_id = 예: 1cor)
//   migration-output/1cor_context_html.html
//   migration-output/1cor_map_locations.json

'use strict';

const fs   = require('fs');
const path = require('path');

const DIR      = path.join(__dirname, 'migration-output');
const SRC_FILE = path.join(DIR, 'toble_nt_background_1cor_to_revelation_v4.json');

const bookArg = process.argv.slice(2).find(a => a.startsWith('--book='));
const onlyBook = bookArg ? bookArg.slice(7) : null;

// JSON 단축 ID → 앱/DB 실제 ID 매핑 (전체 21권)
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
  // titus → titus (동일)
  'philem': 'philemon',
  'heb':    'hebrews',
  'jas':    'james',
  '1pet':   '1peter',
  '2pet':   '2peter',
  // 1john, 2john, 3john, jude → 동일
  'rev':    'revelation',
};

// ─── 도시 좌표 룩업 ─────────────────────────────────────────────
const CITY_COORDS = {
  '에베소':   { lat: 37.9368, lng: 27.3410 },
  '마게도냐': { lat: 41.0,    lng: 22.5    },
  '고린도':   { lat: 37.9333, lng: 22.9347 },
  '로마':     { lat: 41.9028, lng: 12.4964 },
  '예루살렘': { lat: 31.7683, lng: 35.2137 },
  '밧모섬':   { lat: 37.3048, lng: 26.5467 },
  '니고볼리': { lat: 39.0,    lng: 20.7    },
  '안디옥':   { lat: 36.2084, lng: 36.1690 },
  '빌립보':   { lat: 41.0134, lng: 24.2937 },
  '데살로니가':{ lat: 40.6401, lng: 22.9444 },
  '골로새':   { lat: 37.7,    lng: 29.0    },
  '그레데':   { lat: 35.2,    lng: 24.9    },
  '가이사랴': { lat: 32.5,    lng: 34.9    },
  '소아시아': { lat: 38.9,    lng: 29.0    },
};

// 책별 지도에 찍을 도시 목록 (앱 실제 book_id 기준)
const BOOK_CITY_NAMES = {
  '1corinthians':   ['에베소', '고린도'],
  '2corinthians':   ['마게도냐', '고린도'],
  'galatians':      ['안디옥'],
  'ephesians':      ['로마', '에베소'],
  'philippians':    ['로마', '빌립보'],
  'colossians':     ['로마', '골로새'],
  '1thessalonians': ['고린도', '데살로니가'],
  '2thessalonians': ['고린도', '데살로니가'],
  '1timothy':       ['마게도냐', '에베소'],
  '2timothy':       ['로마', '에베소'],
  'titus':          ['마게도냐', '그레데', '니고볼리'],
  'philemon':       ['로마', '골로새'],
  'hebrews':        ['로마', '예루살렘'],
  'james':          ['예루살렘'],
  '1peter':         ['로마', '소아시아'],
  '2peter':         ['로마'],
  '1john':          ['에베소'],
  '2john':          ['에베소'],
  '3john':          ['에베소'],
  'jude':           ['예루살렘'],
  'revelation':     ['밧모섬', '에베소'],
};

// ─── 헬퍼 ────────────────────────────────────────────────────────
function esc(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function circle(i) {
  return ['①','②','③','④','⑤','⑥','⑦','⑧','⑨','⑩','⑪','⑫','⑬','⑭','⑮'][i] || `${i+1}.`;
}

function factRow(k, v) {
  return v ? `<div class="fact"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>` : '';
}

function card(title, body) {
  return body ? `<div class="card">\n<h2>${esc(title)}</h2>\n${body}\n</div>` : '';
}

function ul(arr) {
  if (!arr || !arr.length) return '';
  return `<ul>${arr.map(s => `<li>${esc(s)}</li>`).join('')}</ul>`;
}

// ─── 책 → HTML ───────────────────────────────────────────────────
function buildContextHtml(b) {
  const parts = [];

  // ① 한눈에 보기
  {
    let facts = '';
    facts += factRow('저자', b.author && b.author.traditional);
    facts += factRow('기록 시기', b.date && b.date.range);
    if (b.place && b.place.name) facts += factRow('기록 장소', b.place.name);
    if (b.original_audience && b.original_audience.name)
      facts += factRow('수신자', b.original_audience.name);
    if (b.genre && b.genre.length)
      facts += factRow('장르', b.genre.join(' · '));
    if (b.chapters)
      facts += factRow('장 수', `${b.chapters}장`);
    parts.push(card('한눈에 보기', `<div class="facts">${facts}</div>`));
  }

  // ② 저자
  if (b.author) {
    let body = '';
    body += `<p><strong>${esc(b.author.traditional)}</strong>`;
    if (b.author.assessment) body += `: ${esc(b.author.assessment)}`;
    body += '</p>';
    if (b.author.evidence) body += `<p>${esc(b.author.evidence)}</p>`;
    parts.push(card('저자 — 이 책을 쓴 사람', body));
  }

  // ③ 원독자
  if (b.original_audience) {
    const oa = b.original_audience;
    let body = '';
    if (oa.composition)   body += `<p>${esc(oa.composition)}</p>`;
    if (oa.social_context) body += `<p>${esc(oa.social_context)}</p>`;
    if (body) parts.push(card('원독자 — 이 책을 처음 읽은 사람들', body));
  }

  // ④ 역사적 배경
  if (b.historical_setting) {
    const hs = b.historical_setting;
    let body = '';
    if (hs.details && hs.details.length) body += ul(hs.details);
    if (body) parts.push(card('역사적 배경', body));
  }

  // ⑤ 저작 동기와 목적
  {
    let body = '';
    if (b.occasion && b.occasion.trigger)
      body += `<p>${esc(b.occasion.trigger)}</p>`;
    if (b.occasion && b.occasion.problems && b.occasion.problems.length)
      body += `<p><strong>주요 문제</strong></p>${ul(b.occasion.problems)}`;
    if (b.purpose && b.purpose.length)
      body += `<p><strong>저작 목적</strong></p>${ul(b.purpose)}`;
    if (body) parts.push(card('저작 동기와 목적', body));
  }

  // ⑥ 책의 흐름
  if (b.flow && b.flow.length) {
    const items = b.flow.map((f, i) =>
      `<div class="t-item"><div class="t-title">${circle(i)} ${esc(f.title)} (${esc(f.range)})</div><div class="t-desc">${esc(f.summary)}</div></div>`
    ).join('\n');
    parts.push(card('책의 흐름', `<div class="timeline">${items}</div>`));
  }

  // ⑦ 주요 주제
  if (b.major_themes && b.major_themes.length) {
    const body = ul(b.major_themes);
    parts.push(card('주요 주제', body));
  }

  // ⑧ 배경 (지리·정치·종교)
  if (b.background_layers) {
    const bl = b.background_layers;
    let body = '';
    if (bl.geography)
      body += `<p><strong>지리</strong>: ${esc(bl.geography)}</p>`;
    if (bl.politics_and_society)
      body += `<p><strong>정치·사회</strong>: ${esc(bl.politics_and_society)}</p>`;
    if (bl.religion_and_culture)
      body += `<p><strong>종교·문화</strong>: ${esc(bl.religion_and_culture)}</p>`;
    if (bl.ot_background && bl.ot_background.length)
      body += `<p><strong>구약 배경</strong></p>${ul(bl.ot_background)}`;
    if (body) parts.push(card('배경', body));
  }

  // ⑨ 핵심 용어
  if (b.background_layers && b.background_layers.key_terms && b.background_layers.key_terms.length) {
    const body = b.background_layers.key_terms
      .map(kt => `<p><strong>${esc(kt.term)}</strong>: ${esc(kt.explanation)}</p>`)
      .join('\n');
    parts.push(card('핵심 용어', body));
  }

  // ⑩ 해석 시 주의할 점
  if (b.interpretive_cautions && b.interpretive_cautions.length) {
    const body = b.interpretive_cautions.map(s => `<p>${esc(s)}</p>`).join('\n');
    parts.push(card('해석 시 주의할 점', body));
  }

  // ⑪ 읽기 안내
  if (b.reading_aids && b.reading_aids.questions && b.reading_aids.questions.length) {
    const body = `<p><strong>본문을 읽으며 물어볼 것</strong></p>${ul(b.reading_aids.questions)}`;
    parts.push(card('읽기 안내', body));
  }

  return parts.filter(Boolean).join('\n\n');
}

// ─── map_locations ────────────────────────────────────────────────
function buildMapLocations(bookId) {
  const names = BOOK_CITY_NAMES[bookId] || [];
  return names
    .map(name => ({ name, ...(CITY_COORDS[name] || null) }))
    .filter(loc => loc.lat !== undefined);
}

// ─── main ─────────────────────────────────────────────────────────
function main() {
  const raw = JSON.parse(fs.readFileSync(SRC_FILE, 'utf8'));
  const books = raw.books;

  let processed = 0;
  for (const b of books) {
    // onlyBook는 JSON 단축 ID 또는 앱 전체 ID 모두 허용
    const appId = ID_MAP[b.id] || b.id;
    if (onlyBook && b.id !== onlyBook && appId !== onlyBook) continue;

    const html = buildContextHtml(b);
    const locs = buildMapLocations(appId);

    const htmlPath = path.join(DIR, `${appId}_context_html.html`);
    const locPath  = path.join(DIR, `${appId}_map_locations.json`);

    fs.writeFileSync(htmlPath, html, 'utf8');
    fs.writeFileSync(locPath, JSON.stringify(locs, null, 2), 'utf8');

    const cardCount = (html.match(/class="card"/g) || []).length;
    console.log(`✓ ${appId} (${b.title}): ${cardCount}개 카드, 지도 ${locs.length}곳`);
    processed++;
  }

  if (processed === 0) {
    console.error(`book_id '${onlyBook}'를 찾지 못했습니다.`);
    process.exit(1);
  }
  console.log(`\n완료: ${processed}권 처리`);
}

main();
