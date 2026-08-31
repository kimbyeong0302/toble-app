#!/usr/bin/env node
// 66권 KRV 전체 무결성 감사 — READ-ONLY (SELECT만 사용)
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// 현재 커밋된 CHAPTER_LENGTHS_BY_BOOK 기준값 (c8b6a90)
const CLB = {
  genesis: { 1:31,2:25,3:24,4:26,5:32,6:22,7:24,8:22,9:29,10:32,11:32,12:20,13:18,14:24,15:21,16:16,17:27,18:33,19:38,20:18,21:34,22:24,23:20,24:67,25:34,26:35,27:46,28:22,29:35,30:43,31:55,32:32,33:20,34:31,35:29,36:43,37:36,38:30,39:23,40:23,41:57,42:38,43:34,44:34,45:28,46:34,47:31,48:22,49:33,50:26 },
  exodus: { 1:22,2:25,3:22,4:31,5:23,6:30,7:25,8:32,9:35,10:29,11:10,12:51,13:22,14:31,15:27,16:36,17:16,18:27,19:25,20:26,21:36,22:31,23:33,24:18,25:40,26:37,27:21,28:43,29:46,30:38,31:18,32:35,33:23,34:35,35:35,36:38,37:29,38:31,39:43,40:38 },
  leviticus: { 1:17,2:16,3:17,4:35,5:19,6:30,7:38,8:36,9:24,10:20,11:47,12:8,13:59,14:57,15:33,16:34,17:16,18:30,19:37,20:27,21:24,22:33,23:44,24:23,25:55,26:46,27:34 },
  numbers: { 1:54,2:34,3:51,4:49,5:31,6:27,7:89,8:26,9:23,10:36,11:35,12:16,13:33,14:45,15:41,16:50,17:13,18:32,19:22,20:29,21:35,22:41,23:30,24:25,25:18,26:65,27:23,28:31,29:40,30:16,31:54,32:42,33:56,34:29,35:34,36:13 },
  deuteronomy: { 1:46,2:37,3:29,4:49,5:33,6:25,7:26,8:20,9:29,10:22,11:32,12:32,13:18,14:29,15:23,16:22,17:20,18:22,19:21,20:20,21:23,22:30,23:25,24:22,25:19,26:19,27:26,28:68,29:29,30:20,31:30,32:52,33:29,34:12 },
  joshua: { 1:18,2:24,3:17,4:24,5:15,6:27,7:26,8:35,9:27,10:43,11:23,12:24,13:33,14:15,15:63,16:10,17:18,18:28,19:51,20:9,21:45,22:34,23:16,24:33 },
  judges: { 1:36,2:23,3:31,4:24,5:31,6:40,7:25,8:35,9:57,10:18,11:40,12:15,13:25,14:20,15:20,16:31,17:13,18:31,19:30,20:48,21:25 },
  ruth: { 1:22,2:23,3:18,4:22 },
  '1samuel': { 1:28,2:36,3:21,4:22,5:12,6:21,7:17,8:22,9:27,10:27,11:15,12:25,13:23,14:52,15:35,16:23,17:58,18:30,19:24,20:42,21:15,22:23,23:29,24:22,25:44,26:25,27:12,28:25,29:11,30:30,31:13 },
  '2samuel': { 1:27,2:32,3:39,4:12,5:25,6:23,7:29,8:18,9:13,10:19,11:27,12:31,13:39,14:33,15:37,16:23,17:29,18:33,19:43,20:26,21:22,22:51,23:39,24:25 },
  '1kings': { 1:53,2:46,3:28,4:34,5:18,6:38,7:51,8:66,9:28,10:29,11:43,12:33,13:34,14:31,15:34,16:34,17:24,18:46,19:21,20:43,21:29,22:53 },
  '2kings': { 1:18,2:25,3:27,4:44,5:27,6:33,7:20,8:29,9:37,10:36,11:21,12:21,13:25,14:29,15:38,16:20,17:41,18:37,19:37,20:21,21:26,22:20,23:37,24:20,25:30 },
  '1chronicles': { 1:54,2:55,3:24,4:43,5:26,6:81,7:40,8:40,9:44,10:14,11:47,12:40,13:14,14:17,15:29,16:43,17:27,18:17,19:19,20:8,21:30,22:19,23:32,24:31,25:31,26:32,27:34,28:21,29:30 },
  '2chronicles': { 1:17,2:18,3:17,4:22,5:14,6:42,7:22,8:18,9:31,10:19,11:23,12:16,13:22,14:15,15:19,16:14,17:19,18:34,19:11,20:37,21:20,22:12,23:21,24:27,25:28,26:23,27:9,28:27,29:36,30:27,31:21,32:33,33:25,34:33,35:27,36:23 },
  ezra: { 1:11,2:70,3:13,4:24,5:17,6:22,7:28,8:36,9:15,10:44 },
  nehemiah: { 1:11,2:20,3:32,4:23,5:19,6:19,7:73,8:18,9:38,10:39,11:36,12:47,13:31 },
  esther: { 1:22,2:23,3:15,4:17,5:14,6:14,7:10,8:17,9:32,10:3 },
  job: { 1:22,2:13,3:26,4:21,5:27,6:30,7:21,8:22,9:35,10:22,11:20,12:25,13:28,14:22,15:35,16:22,17:16,18:21,19:29,20:29,21:34,22:30,23:17,24:25,25:6,26:14,27:23,28:28,29:25,30:31,31:40,32:22,33:33,34:37,35:16,36:33,37:24,38:41,39:30,40:24,41:34,42:17 },
  psalms: { 1:6,2:12,3:8,4:8,5:12,6:10,7:17,8:9,9:20,10:18,11:7,12:8,13:6,14:7,15:5,16:11,17:15,18:50,19:14,20:9,21:13,22:31,23:6,24:10,25:22,26:12,27:14,28:9,29:11,30:12,31:24,32:11,33:22,34:22,35:28,36:12,37:40,38:22,39:13,40:17,41:13,42:11,43:5,44:26,45:17,46:11,47:9,48:14,49:20,50:23,51:19,52:9,53:6,54:7,55:23,56:13,57:11,58:11,59:17,60:12,61:8,62:12,63:11,64:10,65:13,66:20,67:7,68:35,69:36,70:5,71:24,72:19,73:28,74:23,75:10,76:12,77:20,78:72,79:13,80:19,81:16,82:8,83:18,84:12,85:13,86:17,87:7,88:18,89:52,90:17,91:16,92:15,93:5,94:23,95:11,96:13,97:12,98:9,99:9,100:5,101:8,102:28,103:22,104:35,105:45,106:48,107:43,108:13,109:31,110:7,111:10,112:10,113:9,114:8,115:18,116:19,117:2,118:29,119:176,120:7,121:8,122:9,123:4,124:8,125:5,126:6,127:5,128:6,129:8,130:8,131:3,132:18,133:3,134:3,135:21,136:26,137:9,138:8,139:24,140:13,141:10,142:7,143:12,144:15,145:21,146:10,147:20,148:14,149:9,150:6 },
  proverbs: { 1:33,2:22,3:35,4:27,5:23,6:35,7:27,8:36,9:18,10:32,11:31,12:28,13:25,14:35,15:33,16:33,17:28,18:24,19:29,20:30,21:31,22:29,23:35,24:34,25:28,26:28,27:27,28:28,29:27,30:33,31:31 },
  ecclesiastes: { 1:18,2:26,3:22,4:16,5:20,6:12,7:29,8:17,9:18,10:20,11:10,12:14 },
  songofsongs: { 1:17,2:17,3:11,4:16,5:16,6:13,7:13,8:14 },
  isaiah: { 1:31,2:22,3:26,4:6,5:30,6:13,7:25,8:22,9:21,10:34,11:16,12:6,13:22,14:32,15:9,16:14,17:14,18:7,19:25,20:6,21:17,22:25,23:18,24:23,25:12,26:21,27:13,28:29,29:24,30:33,31:9,32:20,33:24,34:17,35:10,36:22,37:38,38:22,39:8,40:31,41:29,42:25,43:28,44:28,45:25,46:13,47:15,48:22,49:26,50:11,51:23,52:15,53:12,54:17,55:13,56:12,57:21,58:14,59:21,60:22,61:11,62:12,63:19,64:12,65:25,66:24 },
  jeremiah: { 1:19,2:37,3:25,4:31,5:31,6:30,7:34,8:22,9:26,10:25,11:23,12:17,13:27,14:22,15:21,16:21,17:27,18:23,19:15,20:18,21:14,22:30,23:40,24:10,25:38,26:24,27:22,28:17,29:32,30:24,31:40,32:44,33:26,34:22,35:19,36:32,37:21,38:28,39:18,40:16,41:18,42:22,43:13,44:30,45:5,46:28,47:7,48:47,49:39,50:46,51:64,52:34 },
  lamentations: { 1:22,2:22,3:66,4:22,5:22 },
  ezekiel: { 1:28,2:10,3:27,4:17,5:17,6:14,7:27,8:18,9:11,10:22,11:25,12:28,13:23,14:23,15:8,16:63,17:24,18:32,19:14,20:49,21:32,22:31,23:49,24:27,25:17,26:21,27:36,28:26,29:21,30:26,31:18,32:32,33:33,34:31,35:15,36:38,37:28,38:23,39:29,40:49,41:26,42:20,43:27,44:31,45:25,46:24,47:23,48:35 },
  daniel: { 1:21,2:49,3:30,4:37,5:31,6:28,7:28,8:27,9:27,10:21,11:45,12:13 },
  hosea: { 1:11,2:23,3:5,4:19,5:15,6:11,7:16,8:14,9:17,10:15,11:12,12:14,13:16,14:9 },
  joel: { 1:20,2:32,3:21 },
  amos: { 1:15,2:16,3:15,4:13,5:27,6:14,7:17,8:14,9:15 },
  obadiah: { 1:21 },
  jonah: { 1:17,2:10,3:10,4:11 },
  micah: { 1:16,2:13,3:12,4:13,5:15,6:16,7:20 },
  nahum: { 1:15,2:13,3:19 },
  habakkuk: { 1:17,2:20,3:19 },
  zephaniah: { 1:18,2:15,3:20 },
  haggai: { 1:15,2:23 },
  zechariah: { 1:21,2:13,3:10,4:14,5:11,6:15,7:14,8:23,9:17,10:12,11:17,12:14,13:9,14:21 },
  malachi: { 1:14,2:17,3:18,4:6 },
  matthew: { 1:25,2:23,3:17,4:25,5:48,6:34,7:29,8:34,9:38,10:42,11:30,12:50,13:58,14:36,15:39,16:28,17:27,18:35,19:30,20:34,21:46,22:46,23:39,24:51,25:46,26:75,27:66,28:20 },
  mark: { 1:45,2:28,3:35,4:41,5:43,6:56,7:37,8:38,9:50,10:52,11:33,12:44,13:37,14:72,15:47,16:20 },
  luke: { 1:80,2:52,3:38,4:44,5:39,6:49,7:50,8:56,9:62,10:42,11:54,12:59,13:35,14:35,15:32,16:31,17:37,18:43,19:48,20:47,21:38,22:71,23:56,24:53 },
  john: { 1:51,2:25,3:36,4:54,5:47,6:71,7:53,8:59,9:41,10:42,11:57,12:50,13:38,14:31,15:27,16:33,17:26,18:40,19:42,20:31,21:25 },
  acts: { 1:26,2:47,3:26,4:37,5:42,6:15,7:60,8:40,9:43,10:48,11:30,12:25,13:52,14:28,15:41,16:40,17:34,18:28,19:41,20:38,21:40,22:30,23:35,24:27,25:27,26:32,27:44,28:31 },
  romans: { 1:32,2:29,3:31,4:25,5:21,6:23,7:25,8:39,9:33,10:21,11:36,12:21,13:14,14:23,15:33,16:27 },
  '1corinthians': { 1:31,2:16,3:23,4:21,5:13,6:20,7:40,8:13,9:27,10:33,11:34,12:31,13:13,14:40,15:58,16:24 },
  '2corinthians': { 1:24,2:17,3:18,4:18,5:21,6:18,7:16,8:24,9:15,10:18,11:33,12:21,13:13 },
  galatians: { 1:24,2:21,3:29,4:31,5:26,6:18 },
  ephesians: { 1:23,2:22,3:21,4:32,5:33,6:24 },
  philippians: { 1:30,2:30,3:21,4:23 },
  colossians: { 1:29,2:23,3:25,4:18 },
  '1thessalonians': { 1:10,2:20,3:13,4:18,5:28 },
  '2thessalonians': { 1:12,2:17,3:18 },
  '1timothy': { 1:20,2:15,3:16,4:16,5:25,6:21 },
  '2timothy': { 1:18,2:26,3:17,4:22 },
  titus: { 1:16,2:15,3:15 },
  philemon: { 1:25 },
  hebrews: { 1:14,2:18,3:19,4:16,5:14,6:20,7:28,8:13,9:28,10:39,11:40,12:29,13:25 },
  james: { 1:27,2:26,3:18,4:17,5:20 },
  '1peter': { 1:25,2:25,3:22,4:19,5:14 },
  '2peter': { 1:21,2:22,3:18 },
  '1john': { 1:10,2:29,3:24,4:21,5:21 },
  '2john': { 1:13 },
  '3john': { 1:14 },
  jude: { 1:25 },
  revelation: { 1:20,2:29,3:22,4:11,5:14,6:17,7:17,8:13,9:21,10:11,11:19,12:17,13:18,14:20,15:8,16:21,17:18,18:24,19:21,20:15,21:27,22:21 }
};

// KRV 절수 체계상 없는 것이 정상인 절 (absent = correct)
const KNOWN_ABSENT = new Set(['1samuel-30-31', 'psalms-72-20', '2corinthians-13-14']);

async function main() {
  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(
    process.env.SUPABASE_URL || 'https://tepsuxyfyrkylyhsngwo.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  console.log('KRV / SUPABASE 66권 전체 무결성 감사 (READ-ONLY)\n');
  console.log('전체 데이터 로드 중...');

  // 전체 KRV 절 로드 (페이지네이션)
  let allVerses = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('verses')
      .select('book_id, chapter, verse, text')
      .eq('translation_id', 'krv')
      .order('book_id').order('chapter').order('verse')
      .range(from, from + 999);
    if (error) { console.error('로드 실패:', error.message); process.exit(1); }
    if (!data || data.length === 0) break;
    allVerses = allVerses.concat(data);
    if (data.length < 1000) break;
    process.stdout.write('.');
  }
  console.log(`\n총 ${allVerses.length}절 로드 완료\n`);

  // 데이터 인덱싱
  const byBookChapter = {};  // bookId -> chapterNum -> verseNum -> [rows]
  for (const row of allVerses) {
    const b = row.book_id, c = row.chapter, v = row.verse;
    if (!byBookChapter[b]) byBookChapter[b] = {};
    if (!byBookChapter[b][c]) byBookChapter[b][c] = {};
    if (!byBookChapter[b][c][v]) byBookChapter[b][c][v] = [];
    byBookChapter[b][c][v].push(row);
  }

  const books = Object.keys(CLB);
  const BOOK_NAMES = {
    genesis:'창세기',exodus:'출애굽기',leviticus:'레위기',numbers:'민수기',deuteronomy:'신명기',
    joshua:'여호수아',judges:'사사기',ruth:'룻기','1samuel':'사무엘상','2samuel':'사무엘하',
    '1kings':'열왕기상','2kings':'열왕기하','1chronicles':'역대상','2chronicles':'역대하',
    ezra:'에스라',nehemiah:'느헤미야',esther:'에스더',job:'욥기',psalms:'시편',
    proverbs:'잠언',ecclesiastes:'전도서',songofsongs:'아가',isaiah:'이사야',jeremiah:'예레미야',
    lamentations:'예레미야애가',ezekiel:'에스겔',daniel:'다니엘',hosea:'호세아',joel:'요엘',
    amos:'아모스',obadiah:'오바댜',jonah:'요나',micah:'미가',nahum:'나훔',habakkuk:'하박국',
    zephaniah:'스바냐',haggai:'학개',zechariah:'스가랴',malachi:'말라기',matthew:'마태복음',
    mark:'마가복음',luke:'누가복음',john:'요한복음',acts:'사도행전',romans:'로마서',
    '1corinthians':'고린도전서','2corinthians':'고린도후서',galatians:'갈라디아서',
    ephesians:'에베소서',philippians:'빌립보서',colossians:'골로새서',
    '1thessalonians':'데살로니가전서','2thessalonians':'데살로니가후서',
    '1timothy':'디모데전서','2timothy':'디모데후서',titus:'디도서',philemon:'빌레몬서',
    hebrews:'히브리서',james:'야고보서','1peter':'베드로전서','2peter':'베드로후서',
    '1john':'요한일서','2john':'요한이서','3john':'요한삼서',jude:'유다서',revelation:'요한계시록'
  };

  let totalExpectedChapters = 0, totalActualChapters = 0;
  let totalExpectedVerses = 0, totalActualVerses = 0;
  const bookResults = [];
  const chapterMismatches = [];
  const missingVerses = [];
  const duplicateVerses = [];
  const emptyVerses = [];
  const clbMismatches = [];

  // STEP 4+5+6+7+8+9: 책별/장별/절별 검사
  for (const bookId of books) {
    const clbChapters = CLB[bookId];
    const chNums = Object.keys(clbChapters).map(Number).sort((a,b)=>a-b);
    const expectedChCount = chNums.length;
    totalExpectedChapters += expectedChCount;

    const dbBook = byBookChapter[bookId] || {};
    const actualChNums = Object.keys(dbBook).map(Number).sort((a,b)=>a-b);
    const actualChCount = actualChNums.length;
    totalActualChapters += actualChCount;

    const bookPass = expectedChCount === actualChCount;
    if (!bookPass) {
      chapterMismatches.push({ bookId, expected: expectedChCount, actual: actualChCount });
    }
    bookResults.push({ bookId, name: BOOK_NAMES[bookId]||bookId, expectedChCount, actualChCount, pass: bookPass });

    // 장별 검사
    for (const ch of chNums) {
      const expectedV = clbChapters[ch];
      totalExpectedVerses += expectedV;

      const dbChapter = (dbBook[ch] || {});
      const dbVerseNums = Object.keys(dbChapter).map(Number);
      const actualV = dbVerseNums.length;
      totalActualVerses += actualV;

      // CLB mismatch
      if (actualV !== expectedV) {
        clbMismatches.push({ bookId, ch, expected: expectedV, actual: actualV });
      }

      // 누락 절 검사 (1..expected 범위에서 빠진 절)
      for (let v = 1; v <= expectedV; v++) {
        const key = `${bookId}-${ch}-${v}`;
        if (KNOWN_ABSENT.has(key)) continue;
        if (!dbChapter[v] || dbChapter[v].length === 0) {
          missingVerses.push(`${BOOK_NAMES[bookId]||bookId} ${ch}:${v}`);
        }
      }

      // 중복 절 검사
      for (const [vNum, rows] of Object.entries(dbChapter)) {
        if (rows.length > 1) {
          duplicateVerses.push(`${BOOK_NAMES[bookId]||bookId} ${ch}:${vNum} (count=${rows.length})`);
        }
        // 빈 본문 검사
        for (const row of rows) {
          const t = row.text;
          if (t === null || t === undefined || t.trim() === '') {
            emptyVerses.push(`${BOOK_NAMES[bookId]||bookId} ${ch}:${vNum}`);
          }
        }
      }
    }
  }

  // Acts 23 특별 확인
  const acts23 = (byBookChapter['acts'] || {})[23] || {};
  const acts23count = Object.keys(acts23).length;
  const acts23v35 = acts23[35];
  const acts23v35text = acts23v35 && acts23v35[0] ? acts23v35[0].text : null;
  const acts23v35dup = acts23v35 ? acts23v35.length > 1 : false;
  const acts23v35empty = acts23v35text ? acts23v35text.trim() === '' : true;

  // 실제 DB에 있지만 CLB에 없는 책/장 확인 (extra chapters)
  const dbBooks = Object.keys(byBookChapter);
  const extraBooks = dbBooks.filter(b => !CLB[b]);

  // 결과 출력
  const sep = '━'.repeat(50);
  console.log(sep);
  console.log('KRV / SUPABASE 66권 전체 무결성 검사');
  console.log(sep);

  console.log('\n[BOOKS]');
  console.log(`  Expected: 66`);
  console.log(`  Actual:   ${books.filter(b => byBookChapter[b]).length}`);
  books.forEach(b => {
    const r = bookResults.find(x => x.bookId === b);
    const status = r && r.pass ? 'PASS' : 'FAIL';
    console.log(`  ${status}  ${(BOOK_NAMES[b]||b).padEnd(12)} ch expected=${r.expectedChCount} actual=${r.actualChCount}`);
  });

  console.log('\n[CHAPTERS]');
  console.log(`  Expected: ${totalExpectedChapters}`);
  console.log(`  Actual:   ${totalActualChapters}`);
  console.log(`  Mismatch: ${chapterMismatches.length}`);
  if (chapterMismatches.length > 0) {
    chapterMismatches.forEach(m => console.log(`    FAIL  ${m.bookId}: expected ${m.expected}, actual ${m.actual}`));
  }

  console.log('\n[VERSES]');
  console.log(`  Expected (CLB sum): ${totalExpectedVerses}`);
  console.log(`  Actual (DB count):  ${totalActualVerses}`);
  console.log(`  Difference:         ${totalActualVerses - totalExpectedVerses}`);

  console.log('\n[MISSING VERSES]');
  console.log(`  Count: ${missingVerses.length}`);
  if (missingVerses.length > 0) {
    missingVerses.forEach(v => console.log(`    MISSING: ${v}`));
  }

  console.log('\n[DUPLICATE VERSES]');
  console.log(`  Count: ${duplicateVerses.length}`);
  if (duplicateVerses.length > 0) {
    duplicateVerses.forEach(v => console.log(`    DUPLICATE: ${v}`));
  }

  console.log('\n[EMPTY VERSES]');
  console.log(`  Count: ${emptyVerses.length}`);
  if (emptyVerses.length > 0) {
    emptyVerses.forEach(v => console.log(`    EMPTY: ${v}`));
  }

  console.log('\n[CLB MISMATCH]');
  console.log(`  Count: ${clbMismatches.length}`);
  if (clbMismatches.length > 0) {
    clbMismatches.forEach(m => console.log(`    MISMATCH: ${BOOK_NAMES[m.bookId]||m.bookId} ${m.ch}장 CLB=${m.expected} DB=${m.actual}`));
  }

  console.log('\n[EXTRA BOOKS]');
  console.log(`  Count: ${extraBooks.length}`);
  if (extraBooks.length === 0) {
    console.log('  List: NONE');
  } else {
    extraBooks.forEach(b => console.log(`    EXTRA: ${b}`));
  }

  console.log('\n[ACTS 23 특별 확인]');
  console.log(`  Expected: 35`);
  console.log(`  Actual:   ${acts23count}`);
  console.log(`  Acts 23:35 존재: ${acts23v35 ? 'YES' : 'NO'}`);
  console.log(`  Acts 23:35 본문: ${acts23v35text ? acts23v35text.slice(0, 60) : '(없음)'}`);
  console.log(`  Acts 23:35 중복: ${acts23v35dup ? 'YES' : 'NO'}`);
  console.log(`  Acts 23:35 빈값: ${acts23v35empty ? 'YES' : 'NO'}`);

  // 최종 판정
  const bookCountOk = books.filter(b => byBookChapter[b]).length === 66;
  const chOk = chapterMismatches.length === 0;
  const missingOk = missingVerses.length === 0;
  const dupOk = duplicateVerses.length === 0;
  const emptyOk = emptyVerses.length === 0;
  const clbOk = clbMismatches.length === 0;
  const extraBooksOk = extraBooks.length === 0;
  const acts23ok = acts23count === 35 && acts23v35 && !acts23v35dup && !acts23v35empty;

  const allPass = bookCountOk && chOk && missingOk && dupOk && emptyOk && clbOk && extraBooksOk && acts23ok;

  console.log('\n' + sep);
  console.log(`FINAL RESULT: ${allPass ? 'PASS' : 'FAIL'}`);
  console.log(sep);

  if (!allPass) {
    console.log('\nFAIL 항목:');
    if (!bookCountOk) console.log('  - 책 수 불일치');
    if (!chOk) console.log('  - 장 수 불일치 책 있음');
    if (!missingOk) console.log(`  - 누락 절 ${missingVerses.length}개`);
    if (!dupOk) console.log(`  - 중복 절 ${duplicateVerses.length}개`);
    if (!emptyOk) console.log(`  - 빈 본문 ${emptyVerses.length}개`);
    if (!clbOk) console.log(`  - CLB 불일치 ${clbMismatches.length}개`);
    if (!extraBooksOk) console.log(`  - CLB 외 book_id ${extraBooks.length}개: ${extraBooks.join(', ')}`);
    if (!acts23ok) console.log('  - Acts 23 이상');
  }

  console.log('\n[감사 메타데이터]');
  console.log(`  테이블: verses`);
  console.log(`  컬럼: book_id, chapter, verse, text, translation_id`);
  console.log(`  필터: translation_id = 'krv'`);
  console.log(`  검사 책: ${books.length}권`);
  console.log(`  검사 장: ${totalExpectedChapters}장`);
  console.log(`  검사 절(CLB기준): ${totalExpectedVerses}절`);
  console.log(`  DB 실제 절: ${allVerses.length}절`);
  console.log(`  DB 변경 여부: 없음 (READ-ONLY)`);
  console.log(`  파일 변경 여부: 없음`);
  console.log(`  git commit/push: 없음`);
}

main().catch(err => { console.error('오류:', err.message); process.exit(1); });
