require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  // genesis, leviticus 등 cp가 있는 책 샘플 확인
  const { data } = await sb.from('people').select('book_id,name,role,body,character_profile').in('book_id',['genesis','leviticus','revelation']).limit(4);
  console.log(JSON.stringify(data, null, 2));
  // book_extras context_html 구조도 샘플 확인
  const { data: ext } = await sb.from('book_extras').select('book_id,context_html').eq('book_id','revelation').single();
  console.log('\n=== revelation context_html (앞 3000자) ===');
  console.log(ext.context_html.slice(0, 3000));
  process.exit(0);
})();
