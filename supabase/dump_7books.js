require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs'), path = require('path');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const TARGET = ['ruth','matthew','mark','luke','john','acts','romans'];
const outDir = path.join(__dirname, 'migration-output');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
(async () => {
  for (const b of TARGET) {
    const { data } = await sb.from('book_extras').select('context_html').eq('book_id', b).single();
    const html = (data && data.context_html) || '';
    fs.writeFileSync(path.join(outDir, `ctx_${b}.html`), html, 'utf8');
    console.log(`[${b}] ${html.length}자`);
  }
  process.exit(0);
})();
