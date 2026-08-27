#!/usr/bin/env node
// 요한복음 book_extras.map_locations만 supabase/migration-output/john_map_final.json 내용으로
// 교체한다. context_html·people은 건드리지 않는다(전체 upsert 대신 update 사용).
// 사용법:
//   cd supabase
//   node update_john_map.js --dry-run
//   node update_john_map.js

'use strict';

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const DRY_RUN = process.argv.includes('--dry-run');
const BOOK_ID = 'john';
const MAP_PATH = path.join(__dirname, 'migration-output', 'john_map_final.json');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tepsuxyfyrkylyhsngwo.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_ROLE_KEY) {
  console.error('환경변수 SUPABASE_SERVICE_ROLE_KEY가 필요합니다.');
  process.exit(1);
}

async function main() {
  const raw = fs.readFileSync(MAP_PATH, 'utf8');
  const mapLocations = JSON.parse(raw);
  if (!Array.isArray(mapLocations)) throw new Error('map_locations 파일이 배열이 아닙니다.');
  mapLocations.forEach((loc, i) => {
    if (typeof loc.lat !== 'number' || typeof loc.lng !== 'number' || !loc.name) {
      throw new Error(`map_locations[${i}]에 lat/lng/name이 올바르지 않습니다: ${JSON.stringify(loc)}`);
    }
  });

  console.log(`  ${BOOK_ID} 마커 ${mapLocations.length}개: ${mapLocations.map((l) => l.name).join(', ')}`);

  if (DRY_RUN) {
    console.log('\n--dry-run: 아무것도 보내지 않았습니다.');
    return;
  }

  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { error, data } = await supabase
    .from('book_extras')
    .update({ map_locations: mapLocations })
    .eq('book_id', BOOK_ID)
    .select('book_id');
  if (error) throw new Error(`update 실패: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error(`book_extras에 book_id='${BOOK_ID}' 행이 없어 update가 아무 행도 못 바꿨습니다. migrate_book_extras.js로 최초 upsert가 필요합니다.`);
  }
  console.log(`  update ${data.length}행 완료 (book_id=${BOOK_ID})`);
}

main().catch((err) => {
  console.error('\n실패:', err.message);
  process.exit(1);
});
