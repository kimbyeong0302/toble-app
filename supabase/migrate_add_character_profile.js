#!/usr/bin/env node
// people 테이블에 character_profile JSONB 컬럼이 있는지 확인한다.
// - 없으면: migrations/001_add_character_profile.sql 내용을 출력하고
//   Supabase 대시보드 → SQL 편집기에서 실행하도록 안내한다.
// - 있으면: 이미 완료됨을 보고한다.
//
// 사용법
//   cd supabase
//   node migrate_add_character_profile.js

'use strict';

const fs   = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('환경변수 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function main() {
  console.log('people.character_profile 컬럼 존재 여부 확인 중...\n');

  // character_profile 컬럼을 SELECT 해서 오류 발생 여부로 컬럼 존재 판단
  const { error } = await supabase.from('people').select('character_profile').limit(0);

  if (error && error.message && error.message.includes('character_profile')) {
    const sqlPath = path.join(__dirname, 'migrations', '001_add_character_profile.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('⚠  character_profile 컬럼이 없습니다.\n');
    console.log('아래 SQL을 Supabase 대시보드 → SQL 편집기에 붙여 넣고 실행하세요:\n');
    console.log('─'.repeat(60));
    console.log(sql);
    console.log('─'.repeat(60));
    console.log('\n실행 후 이 스크립트를 다시 돌리면 완료 여부를 재확인합니다.');
    process.exit(0);
  }

  if (error) {
    console.error('예상치 못한 오류:', error.message);
    process.exit(1);
  }

  console.log('✓ character_profile 컬럼이 이미 존재합니다. 마이그레이션 완료.');
}

main().catch(e => { console.error(e); process.exit(1); });
