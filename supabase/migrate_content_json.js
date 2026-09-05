#!/usr/bin/env node
// migrate_content_json.js
// *_content.json 파일 → Supabase
//
// 대상: genesis·exodus·leviticus·numbers (OT 4권) + NT 21권
//
// 작업:
//   1. notes 삽입 (25권 모두 — 현재 DB 0)
//   2. people 삽입 (OT 4권만 — NT는 기존 richer 데이터 유지)
//   3. book_extras.context_html + map_locations (OT 4권 신규 삽입)
//   4. book_extras.map_locations만 업데이트 (NT — context_html 건드리지 않음)
//
// 안전 규칙
//   - notes: 책 단위 DELETE 후 INSERT
//   - OT people: 책 단위 DELETE 후 INSERT
//   - NT people/context_html: 건드리지 않음
//   - 금지 출처 포함 note 자동 스킵
//
// 사용법
//   cd supabase
//   node migrate_content_json.js --dry-run
//   node migrate_content_json.js --book=genesis
//   node migrate_content_json.js          (전체 25권)

'use strict';
const fs   = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const DRY_RUN   = process.argv.includes('--dry-run');
const bookArg   = process.argv.slice(2).find(a => a.startsWith('--book='));
const ONLY_BOOK = bookArg ? bookArg.slice(7) : null;
const SUPABASE_URL    = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) { console.error('env 필요'); process.exit(1); }

const DIR = path.join(__dirname, 'migration-output');

// ─── HTML 이스케이프 ───────────────────────────────────────────────
function esc(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─── 금지 출처 ────────────────────────────────────────────────────
// 무조건 금지 (이단 판정 계열 등 — 학술 인용 있어도 reject)
const MANDATORY_REJECT = [
  /scripturecentral\.org/i,
  /lds\.org/i,
  /ldsliving\.com/i,
  /ehrmanblog\.org/i,
  /bartehrman\.com/i,
  /lifehopeandtruth\.com/i,
  /ucg\.org/i,
  /auss\.au\.edu/i,
  /andrews\.edu\/seminary/i,
  /jats\.nu/i,
];
// 학술 마커가 없을 때만 reject (블로그/비학술 웹사이트)
const SOFT_REJECT_RE = [
  /bible\.org\b/i,
  /patheos\.com/i,
  /crossexamined\.org/i,
  /desiringgod\.org/i,
  /reasons\.org/i,
  /reformation21\.org/i,
  /reformedarsenal\.com/i,
  /mattayars\.com/i,
  /catholicproductions\.com/i,
  /apologeticspress\.org/i,
  /thetorah\.com/i,
  /galaxie\.com/i,
  /grokipedia\.com/i,
  /icr\.org/i,
  /creation\.com/i,
  /biblegateway\.com/i,
];
const ACADEMIC_RE = [
  /본문\s*(구조|어휘|문맥|대조|분석|내러티브)/,
  /BDB|HALOT|TWOT|TDNT|TDOT/,
  /NICOT|NICNT|WBC|Anchor\s*Bible|JPS|ICC|Hermeneia|Tyndale|BECNT|NAC|TOTC|BST/,
  /Eerdmans|Oxford\s*Univ|Cambridge\s*Univ|Yale\s*Univ|Harvard\s*Univ|IVP\s*Academic|Jewish\s*Publication/,
  /JBL\b|VT\s*\d|JSOT\b|CBQ\b|NTS\b|ZAW\b|ZNW\b|Biblica\b|TynBul|JETS\b|WTJ\b/,
  /학위논문|박사논문|석사논문/,
  /Jacob\s*Milgrom|Gordon\s*Wenham|Brevard\s*Childs|Walter\s*Brueggemann/,
  /R\.?\s*K\.?\s*Harrison|E\.?\s*A\.?\s*Speiser|Kenneth\s*Kitchen/,
  /C\.?\s*F\.?\s*Keil|F\.?\s*Delitzsch|Franz\s*Delitzsch/,
  /Timothy\s*Ashley|Philip\s*Budd|Baruch\s*Levine/,
  /Tremper\s*Longman|John\s*H\.?\s*Walton|James\s*K\.?\s*Hoffmeier/,
  /G\.?\s*K\.?\s*Beale|Douglas\s*Moo|N\.?\s*T\.?\s*Wright|Thomas\s*Schreiner/,
  /F\.?\s*F\.?\s*Bruce|I\.?\s*Howard\s*Marshall|Leon\s*Morris|Craig\s*Keener/,
  /Philo\b|Josephus\b|Augustine\b|Jerome\b|Origen\b|Eusebius\b/,
];
function skipNote(src) {
  if (!src) return false;
  // 1) 무조건 금지 출처
  if (MANDATORY_REJECT.some(p => p.test(src))) return true;
  // 2) 학술 마커가 있으면 유지 (블로그가 같이 있어도 OK)
  if (ACADEMIC_RE.some(p => p.test(src))) return false;
  // 3) 학술 마커 없이 URL/비학술 사이트만 있으면 스킵
  if (/https?:\/\/|www\.|\.org\b|\.com\b/i.test(src)) return true;
  return false;
}

// ─── 제목 추출 ────────────────────────────────────────────────────
function extractTitle(content) {
  if (!content) return null;
  const q = content.match(/^[''"]([^''"]{4,55})[''"][\s\-—]/);
  if (q) return q[1].trim();
  const s = content.match(/^([^.。！!]{10,50})[.。！!]/);
  if (s) return s[1].trim();
  return content.length > 50 ? content.substring(0, 48).trim() + '…' : content.trim();
}

// ─── ref 파싱 ─────────────────────────────────────────────────────
function parseRef(ref) {
  if (!ref) return null;
  const c = String(ref).replace(/\s*[（(][^）)]*[）)]/g, '').trim();
  const m = c.match(/^(\d+):(\d+)(?:[~\-–—](\d+))?/);
  if (!m) return null;
  return { chapter: +m[1], verse_start: +m[2], verse_end: m[3] ? +m[3] : null };
}
function parseLvRef(chapter, verse) {
  const v = String(verse).match(/(\d+)(?:[~\-–—](\d+))?/);
  if (!v) return null;
  return { chapter: +chapter, verse_start: +v[1], verse_end: v[2] ? +v[2] : null };
}
function parseNuRef(chapter, verse) {
  const v = String(verse).match(/(?:\d+:)?(\d+)(?:[~\-–—](\d+))?/);
  if (!v) return null;
  return { chapter: +chapter, verse_start: +v[1], verse_end: v[2] ? +v[2] : null };
}

// ─── verse_ref 정리 ───────────────────────────────────────────────
function cleanRef(r) {
  if (!r) return null;
  return String(r).replace(/\n/g, '; ').replace(/\s{2,}/g, ' ').trim().slice(0, 500);
}

// ─── notes 파싱 ───────────────────────────────────────────────────
function parseNotes(bookId, raw, type) {
  const map = new Map(), skipped = [];
  for (const n of (raw.notes || [])) {
    let ref, content, src;
    if (type === 'leviticus') {
      ref = parseLvRef(n.chapter, n.verse); content = n.note_text; src = n.source;
    } else if (type === 'numbers') {
      ref = parseNuRef(n.chapter, n.verse); content = n.content; src = n.source;
    } else {
      ref = parseRef(n.ref); content = n.content; src = n.src;
    }
    if (!ref || !content) continue;
    if (skipNote(src)) { skipped.push(`${ref.chapter}:${ref.verse_start} [${(src||'').slice(0,50)}]`); continue; }
    const ve = ref.verse_end || ref.verse_start;
    const key = `${ref.chapter}:${ref.verse_start}:${ve}`;
    if (map.has(key)) {
      // 같은 구절 범위 중복 — body 합치기
      const existing = map.get(key);
      existing.body = existing.body + '\n\n' + content;
      if (src && !existing.src) existing.src = src;
    } else {
      map.set(key, { book_id: bookId, chapter: ref.chapter, verse_start: ref.verse_start,
        verse_end: ve, title: extractTitle(content), body: content,
        grammar_note: null, refs: null, src: src || null });
    }
  }
  return { rows: Array.from(map.values()), skipped };
}

// ─── people 파싱 ──────────────────────────────────────────────────
function parsePeople(bookId, raw, type) {
  return (raw.people || []).map(p => {
    let name, role, body, verse_ref;
    if (type === 'numbers') {
      name = p.name; role = p.role || null;
      body = p.description; verse_ref = cleanRef(p.refs || p.verse_refs);
    } else if (type === 'leviticus') {
      name = p.name; role = null;
      body = p.description; verse_ref = cleanRef(p.source);
    } else { // standard (gn, ex)
      name = p.name; role = null;
      body = p.note || p.description; verse_ref = cleanRef(p.verses);
    }
    name = (name || '').replace(/\s*\(.*?\)\s*$/, '').trim();
    if (!name || !body) return null;
    return { book_id: bookId, name, role, verse_ref, body, character_profile: null };
  }).filter(Boolean);
}

// ─── context_html 생성 ────────────────────────────────────────────
const GN_EX_LABELS = {
  '한눈에_보기': '한눈에 보기',
  '원저자':      '원저자 — 이 책을 쓴 사람',
  '저작연대':    '저작 연대',
  '특징적_주제': '특징적 주제',
  '이야기의_흐름': '이야기의 흐름',
};
const NU_LABELS = {
  '1': '민수기 개관',
  '2': '2장: 진영 배치',
  '3': '3장: 레위 지파',
  '4': '4장: 성막 운반 임무',
};

function makeCard(title, body) {
  if (!body) return '';
  return `<div class="card">\n<h2>${esc(title)}</h2>\n${body}\n</div>`;
}

function parseContextHtml(raw, type) {
  if (type === 'leviticus') {
    return (raw.context_html_by_part || [])
      .map(p => makeCard(p.part_label || `${p.part}부`, p.context_html || ''))
      .filter(Boolean).join('\n\n');
  }
  const ctx = raw.context_html;
  if (typeof ctx === 'string') return ctx;
  if (ctx && typeof ctx === 'object') {
    const LABELS = type === 'numbers' ? NU_LABELS : GN_EX_LABELS;
    return Object.entries(ctx)
      .map(([k, v]) => {
        if (!v) return '';
        const label = LABELS[k] || k.replace(/_/g, ' ');
        const body  = v.trim().startsWith('<') ? v : `<p>${esc(v)}</p>`;
        return makeCard(label, body);
      }).filter(Boolean).join('\n\n');
  }
  return '';
}

// ─── map_locations 정규화 ─────────────────────────────────────────
function normalizeMapLoc(loc) {
  let location_info = null;
  if (loc.location_info && typeof loc.location_info === 'object') {
    location_info = { ...loc.location_info };
  } else {
    const li = {};
    if (loc['설명'] || loc.description) li['설명'] = loc['설명'] || loc.description;
    if (loc['고도'])  li['고도']  = loc['고도'];
    if (loc['지형'])  li['지형']  = loc['지형'];
    if (loc['기후'])  li['기후']  = loc['기후'];
    if (loc['절기'])  li['절기']  = loc['절기'];
    if (loc['지명뜻']) li['지명뜻'] = loc['지명뜻'];
    if (loc.source || loc.sources) li['src'] = loc.source || loc.sources;
    if (Object.keys(li).length) location_info = li;
  }
  return {
    name: loc.name || loc.name_kor,
    lat:  loc.lat,
    lng:  loc.lng,
    verse_ref:      loc.verses || loc.refs || null,
    search_aliases: loc.search_aliases || null,
    location_info,
  };
}

// ─── 책 설정 ──────────────────────────────────────────────────────
const BOOK_CONFIG = [
  { id: 'genesis',       file: 'gn_content.json',         type: 'standard', isOT: true  },
  { id: 'exodus',        file: 'ex_content.json',         type: 'standard', isOT: true  },
  { id: 'leviticus',     file: 'lv_content_full_1.json',  type: 'leviticus', isOT: true  },
  { id: 'numbers',       file: 'nu_content.json',         type: 'numbers',  isOT: true  },
  { id: '1corinthians',  file: '1co_content.json', type: 'standard', isOT: false },
  { id: '2corinthians',  file: '2co_content.json', type: 'standard', isOT: false },
  { id: 'galatians',     file: 'gl_content.json',  type: 'standard', isOT: false },
  { id: 'ephesians',     file: 'eph_content.json', type: 'standard', isOT: false },
  { id: 'philippians',   file: 'ph_content.json',  type: 'standard', isOT: false },
  { id: 'colossians',    file: 'cl_content.json',  type: 'standard', isOT: false },
  { id: '1thessalonians',file: '1ts_content.json', type: 'standard', isOT: false },
  { id: '2thessalonians',file: '2ts_content.json', type: 'standard', isOT: false },
  { id: '1timothy',      file: '1tm_content.json', type: 'standard', isOT: false },
  { id: '2timothy',      file: '2tm_content.json', type: 'standard', isOT: false },
  { id: 'titus',         file: 'tt_content.json',  type: 'standard', isOT: false },
  { id: 'philemon',      file: 'phm_content.json', type: 'standard', isOT: false },
  { id: 'hebrews',       file: 'hb_content.json',  type: 'standard', isOT: false },
  { id: 'james',         file: 'jm_content.json',  type: 'standard', isOT: false },
  { id: '1peter',        file: '1pe_content.json', type: 'standard', isOT: false },
  { id: '2peter',        file: '2pe_content.json', type: 'standard', isOT: false },
  { id: '1john',         file: '1jo_content.json', type: 'standard', isOT: false },
  { id: '2john',         file: '2jo_content.json', type: 'standard', isOT: false },
  { id: '3john',         file: '3jo_content.json', type: 'standard', isOT: false },
  { id: 'jude',          file: 'jd_content.json',  type: 'standard', isOT: false },
  { id: 'revelation',    file: 're_content.json',  type: 'standard', isOT: false },
];

// ─── 책 처리 ──────────────────────────────────────────────────────
async function processBook(sb, cfg) {
  const fp = path.join(DIR, cfg.file);
  if (!fs.existsSync(fp)) { console.log(`  ⚠ 파일 없음: ${cfg.file}`); return; }
  const raw    = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const bookId = cfg.id;

  // 1) notes
  const { rows: noteRows, skipped } = parseNotes(bookId, raw, cfg.type);
  console.log(`  notes: ${noteRows.length}개 삽입 예정, ${skipped.length}개 스킵`);
  if (skipped.length) console.log('    스킵된 notes:', skipped.slice(0,5).join(' | ') + (skipped.length>5?` …(${skipped.length})`:''));

  // 2) people (OT only)
  let peopleRows = [];
  if (cfg.isOT) {
    peopleRows = parsePeople(bookId, raw, cfg.type);
    console.log(`  people: ${peopleRows.length}명`);
  }

  // 3) context_html + map_locations
  const contextHtml = cfg.isOT ? parseContextHtml(raw, cfg.type) : null;
  const mapLocs = (raw.map_locations || []).map(normalizeMapLoc)
    .filter(l => l.name && l.lat != null && l.lng != null);
  if (cfg.isOT) console.log(`  context_html: ${contextHtml ? contextHtml.length+'자' : '없음'}`);
  console.log(`  map_locations: ${mapLocs.length}곳`);

  if (DRY_RUN) return;

  // notes: DELETE → INSERT
  const { error: delN } = await sb.from('notes').delete().eq('book_id', bookId);
  if (delN) throw new Error(`notes DELETE: ${delN.message}`);
  for (let i = 0; i < noteRows.length; i += 100) {
    const { error } = await sb.from('notes').insert(noteRows.slice(i, i + 100));
    if (error) throw new Error(`notes INSERT: ${error.message}`);
  }
  console.log(`  → notes: ${noteRows.length}행 삽입 완료`);

  // OT people: DELETE → INSERT
  if (cfg.isOT && peopleRows.length > 0) {
    const { error: delP } = await sb.from('people').delete().eq('book_id', bookId);
    if (delP) throw new Error(`people DELETE: ${delP.message}`);
    const { error: insP } = await sb.from('people').insert(peopleRows);
    if (insP) throw new Error(`people INSERT: ${insP.message}`);
    console.log(`  → people: ${peopleRows.length}행 삽입 완료`);
  }

  // book_extras
  if (cfg.isOT) {
    const { error } = await sb.from('book_extras').upsert(
      { book_id: bookId, context_html: contextHtml, map_locations: mapLocs },
      { onConflict: 'book_id' }
    );
    if (error) throw new Error(`book_extras upsert: ${error.message}`);
    console.log(`  → book_extras: context_html + map_locations upsert 완료`);
  } else if (mapLocs.length > 0) {
    // NT: map_locations만 업데이트 (context_html 건드리지 않음)
    const { error } = await sb.from('book_extras').update({ map_locations: mapLocs }).eq('book_id', bookId);
    if (error) throw new Error(`book_extras map_locations update: ${error.message}`);
    console.log(`  → book_extras.map_locations: 업데이트 완료`);
  } else {
    console.log(`  → book_extras.map_locations: 데이터 없음 — 스킵`);
  }
}

// ─── main ─────────────────────────────────────────────────────────
async function main() {
  const sb = DRY_RUN ? null : require('@supabase/supabase-js').createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const targets = ONLY_BOOK ? BOOK_CONFIG.filter(c => c.id === ONLY_BOOK) : BOOK_CONFIG;
  if (!targets.length) { console.error(`'${ONLY_BOOK}' 없음`); process.exit(1); }
  console.log(DRY_RUN ? '=== DRY-RUN ===' : '=== 실제 삽입 ===');
  let ok = 0, fail = 0;
  for (const cfg of targets) {
    console.log(`\n[${cfg.id}]`);
    try { await processBook(sb, cfg); ok++; }
    catch (e) { console.error(`  ✗ ${e.message}`); fail++; }
  }
  console.log(`\n=== 완료: 성공 ${ok}권 / 실패 ${fail}권 ===`);
}
main().catch(e => { console.error(e); process.exit(1); });
