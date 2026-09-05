const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// 수정할 좌표 목록 (검증된 값)
const FIXES = {
  genesis: [
    { name: '브엘세바',      lat: 31.2400, lng: 34.8350 }, // 텔 베에르셰바 유적 (UNESCO)
    { name: '벧엘(루스)',     lat: 31.9270, lng: 35.2340 }, // 텔 베이틴
    { name: '브니엘(얍복강)', lat: 32.1583, lng: 35.7194 }, // 텔 에드-다합
  ],
  john: [
    { name: '수가성(사마리아)', lat: 32.2131, lng: 35.2878 }, // 야곱의 우물 (Bir Ya'qub)
    { name: '에브라임',         lat: 31.9525, lng: 35.3106 }, // 에트-타이베
  ],
  acts: [
    { name: '사마리아', lat: 32.2872, lng: 35.1994 }, // 세바스테 유적 (고대 사마리아 도시)
  ],
  romans: [
    { name: '겐그레아', lat: 37.8744, lng: 23.0094 }, // 케크리에스 항구 유적
  ],
  revelation: [
    { name: '두아디라', lat: 38.9178, lng: 27.8400 }, // 아크히사르 (Thyatira)
  ],
};

async function run() {
  for (const [bookId, changes] of Object.entries(FIXES)) {
    const { data, error: fetchErr } = await sb.from('book_extras')
      .select('map_locations')
      .eq('book_id', bookId)
      .maybeSingle();

    if (fetchErr || !data) {
      console.error(`[FAIL] fetch ${bookId}:`, fetchErr?.message);
      continue;
    }

    const locs = data.map_locations || [];
    let changed = 0;
    for (const fix of changes) {
      const loc = locs.find(l => l.name === fix.name);
      if (!loc) {
        console.warn(`  [WARN] not found: ${fix.name} in ${bookId}`);
        continue;
      }
      const oldLat = loc.lat, oldLng = loc.lng;
      loc.lat = fix.lat;
      loc.lng = fix.lng;
      changed++;
      console.log(`  ${fix.name}: (${oldLat}, ${oldLng}) → (${fix.lat}, ${fix.lng})`);
    }

    if (changed === 0) continue;

    const { error: updErr } = await sb.from('book_extras')
      .update({ map_locations: locs })
      .eq('book_id', bookId);

    if (updErr) {
      console.error(`[FAIL] update ${bookId}:`, updErr.message);
    } else {
      console.log(`[OK]   ${bookId} — ${changed}개 수정`);
    }
  }
  console.log('\n완료');
}

run().catch(console.error);
