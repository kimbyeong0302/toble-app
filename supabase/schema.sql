-- 토블 (성경을 톺아보다) — Supabase 스키마 설계안
-- 이 파일은 아직 실행하지 않았습니다. 검토 후 확정되면 Supabase SQL Editor에서 실행합니다.
--
-- TODO: book_extras.context_html을 나중에 context_cards 테이블
-- (book_id, title, body, src 컬럼)로 리팩터링해서 카드 단위 편집/각주가
-- 가능하게 할 것

-- ============================================================
-- 1. 공용 콘텐츠 테이블 (모든 사용자가 함께 보는 데이터: 책, 본문, 학자노트, 인물)
--    쓰기는 관리자(서비스 롤)만, 읽기는 누구나 가능하도록 RLS를 건다.
-- ============================================================

create table books (
  id text primary key,                 -- 'ruth', 'matthew' 등 지금 코드의 book id와 동일하게
  name_ko text not null,                -- '룻기', '마태복음'
  testament text not null check (testament in ('old', 'new')),
  order_num int not null,               -- 성경 목차 순서
  chapter_count int not null,
  available boolean not null default false
);

-- 역본(번역본). 지금은 개역한글 하나뿐이지만, 나중에 여러 역본을 추가한다고 하셔서 처음부터 분리해둠
-- id는 index.html의 기존 VERSIONS 레지스트리와 동일한 키를 그대로 사용한다 ('krv' = 개역한글)
create table translations (
  id text primary key,                  -- 'krv'(개역한글) 등
  name_ko text not null
);

create table verses (
  id bigint generated always as identity primary key,
  book_id text not null references books(id),
  translation_id text not null references translations(id),
  chapter int not null,
  verse int not null,
  text text not null,
  unique (book_id, translation_id, chapter, verse)
);
create index verses_lookup on verses (book_id, translation_id, chapter);

-- 학자노트 (지금의 TEACHER_NOTES_RUTH 등)
create table notes (
  id bigint generated always as identity primary key,
  book_id text not null references books(id),
  chapter int not null,
  verse_start int not null,
  verse_end int not null,
  title text,
  body text not null,
  grammar_note text,                    -- 원어/문법 설명 (지금 데이터의 g 필드 — 있는 노트에만 존재)
  refs text,                            -- "마태복음 16:21, 20:19" 같은 원문 참조 문자열 (지금 렌더링 방식 그대로 유지)
  src text,                             -- 출처 — 관리자 화면에서 편집. 마이그레이션 당시 데이터에는 없던 필드
  unique (book_id, chapter, verse_start, verse_end)  -- 관리자 화면에서 절 하나당 노트 upsert가 가능하도록
);
create index notes_lookup on notes (book_id, chapter, verse_start, verse_end);

-- 인물 (지금의 PEOPLE_RUTH 등)
create table people (
  id bigint generated always as identity primary key,
  book_id text not null references books(id),
  name text not null,
  role text,                            -- 지금 데이터의 role 필드 ("주인공 · 룻의 시모" 등)
  verse_ref text,                       -- 지금 데이터의 v 필드 ("1장 전반, 이후 지속" 등 등장 구간 설명)
  body text not null
);
create index people_lookup on people (book_id);

-- 배경(ctx-book 카드 HTML)과 지도(MAP_LOCATIONS 좌표) — 책마다 한 행.
-- 요청하신 "map_svg"는 실제로는 없습니다: 지도는 SVG가 아니라 Leaflet + 좌표 배열(JS)로 그려지고
-- 있어서, 그 좌표 배열을 그대로 옮길 수 있게 map_locations(jsonb)로 이름을 바꿨습니다.
create table book_extras (
  book_id text primary key references books(id),
  context_html text not null,           -- 지금 .ctx-book[data-book] 안의 카드 HTML 통째로
  map_locations jsonb not null default '[]'::jsonb  -- [{name, lat, lng}, ...] — 지금 MAP_LOCATIONS[bookId]와 동일한 구조
);

alter table books enable row level security;
alter table translations enable row level security;
alter table verses enable row level security;
alter table notes enable row level security;
alter table people enable row level security;
alter table book_extras enable row level security;

create policy "공개 읽기" on books for select using (true);
create policy "공개 읽기" on translations for select using (true);
create policy "공개 읽기" on verses for select using (true);
create policy "공개 읽기" on notes for select using (true);
create policy "공개 읽기" on people for select using (true);
create policy "공개 읽기" on book_extras for select using (true);
-- insert/update/delete 정책을 아예 만들지 않음 → 일반 사용자(anon/authenticated)는 쓰기 불가.
-- 콘텐츠 등록/수정은 Supabase 대시보드나 service_role 키로만 한다.

-- ============================================================
-- 2. 사용자별 데이터 테이블 (하이라이트, 메모, 학습노트)
--    각자 자기 것만 읽고 쓸 수 있도록 RLS로 강제한다.
-- ============================================================

-- 실제 로컬 구현(hlw_/hls_ localStorage 키)을 그대로 옮긴 구조로 정정함:
-- 절 하나를 통째로 "verse/word/sentence + range"로 나누는 게 아니라, 절 하나당 행 하나에
-- "어절 인덱스 → 색" 맵을 그대로 저장한다. is_full_verse는 절 전체를 한 번에 칠했는지
-- 표시(로컬의 hls_ 대응) — 지울 때 한 절을 통째로 지울지, 어절 하나만 지울지 구분하는 용도.
create table highlights (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id text not null references books(id),
  chapter int not null,
  verse int not null,
  word_colors jsonb not null default '{}'::jsonb,  -- {"0":"yellow","3":"green"} — 로컬 hlw_ 맵과 동일 구조
  is_full_verse boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (user_id, book_id, chapter, verse)
);

-- 실제 로컬 구현(memos_<book> 안의 {key: text} 맵)에 맞춰 정정함: 메모 키가 절 하나가
-- 아니라 "1-3" 또는 여러 절을 묶은 "1-3+1-4" 같은 복합 키일 수 있어서, chapter/verse로
-- 쪼개지 않고 그 키 문자열을 그대로 저장한다.
create table memos (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id text not null references books(id),
  verse_key text not null,              -- 로컬 메모 키 그대로 (예: "1-3", "1-3+1-4")
  content text not null,
  updated_at timestamptz not null default now(),
  unique (user_id, book_id, verse_key)
);

-- 실제 로컬 구현(study_<book>_<key>_obs/interp/app/step 네 개의 개별 키)에 맞춰 정정함:
-- 절 하나(복합 키 포함)당 관찰·해석·적용 세 칸과 진행 단계(step)를 한 행에 묶어 저장한다.
create table study_notes (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id text not null references books(id),
  verse_key text not null,              -- "1-3" 또는 복합 "1-3+1-4"
  obs text not null default '',
  interp text not null default '',
  app text not null default '',
  step int not null default 1,
  updated_at timestamptz not null default now(),
  unique (user_id, book_id, verse_key)
);

create index highlights_user_lookup on highlights (user_id, book_id, chapter);
create index memos_user_lookup on memos (user_id, book_id);
create index study_notes_user_lookup on study_notes (user_id, book_id);

alter table highlights enable row level security;
alter table memos enable row level security;
alter table study_notes enable row level security;

create policy "본인 조회" on highlights for select using (auth.uid() = user_id);
create policy "본인 추가" on highlights for insert with check (auth.uid() = user_id);
create policy "본인 수정" on highlights for update using (auth.uid() = user_id);
create policy "본인 삭제" on highlights for delete using (auth.uid() = user_id);

create policy "본인 조회" on memos for select using (auth.uid() = user_id);
create policy "본인 추가" on memos for insert with check (auth.uid() = user_id);
create policy "본인 수정" on memos for update using (auth.uid() = user_id);
create policy "본인 삭제" on memos for delete using (auth.uid() = user_id);

create policy "본인 조회" on study_notes for select using (auth.uid() = user_id);
create policy "본인 추가" on study_notes for insert with check (auth.uid() = user_id);
create policy "본인 수정" on study_notes for update using (auth.uid() = user_id);
create policy "본인 삭제" on study_notes for delete using (auth.uid() = user_id);

-- ============================================================
-- 3. 관리자 — admin.html에서 학자노트(notes)를 직접 편집할 수 있게 해준다.
--    role은 3단계: 'user'(기본) < 'admin'(노트 편집) < 'owner'(admin이 하는 모든 것 +
--    다른 사용자의 role을 user<->admin으로 변경). owner 지정은 여기 SQL로 하지 않고
--    대시보드에서 본인 계정만 별도로 직접 실행한다.
-- ============================================================

-- subscription_* 4개 컬럼은 월 정액 결제를 붙이기 전 단계로, "구독 상태를 보고 관리만"
-- 할 수 있게 미리 만들어둔 것이다. 실제 PG사 연동 전이라 지금은 admin.html의 사용자
-- 관리 화면에서 owner가 수동으로만 값을 바꾸고, 하이라이트/노트 같은 실제 기능과는
-- 아직 연결하지 않는다 — 나중에 결제를 붙일 때 "만료면 기능 제한" 로직을 여기 붙인다.
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'user' check (role in ('user', 'admin', 'owner')),
  subscription_status text not null default 'none' check (subscription_status in ('none', 'active', 'expired', 'cancelled')),
  subscription_started_at timestamptz,
  subscription_expires_at timestamptz,
  subscription_note text
);
alter table profiles enable row level security;

-- is_owner()/is_admin_or_owner(): security definer로 만들어서 함수 안에서 profiles를
-- 조회할 때 RLS를 타지 않게 한다. 정책 안에 exists(select ... from profiles ...)를
-- 그대로 박아넣으면, 같은 테이블(profiles)의 SELECT/UPDATE 정책이 서로를 다시
-- 평가하려 들면서 "infinite recursion detected in policy" 에러가 난다 — 실제로 겪은
-- 버그이고, 이 두 헬퍼 함수로 우회하는 게 정석 해법이다.
create or replace function is_owner()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'owner');
$$;

create or replace function is_admin_or_owner()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin', 'owner'));
$$;
-- 본인 행은 항상 보이고, owner는 role 변경 대상을 찾아야 하니 모든 행이 보여야 한다
-- (안 그러면 UPDATE 후보 행 자체가 안 보여서 owner의 role 변경이 "성공했지만 0행 변경"으로
-- 조용히 실패한다 — 이것도 실제로 겪은 버그).
create policy "본인 조회 또는 owner는 전체 조회" on profiles for select
using (auth.uid() = id or is_owner());
-- insert 정책 없음 — 신규 유저의 profiles 행은 admin_search_users()가 필요할 때 만들어준다.

-- owner만 다른 사용자의 role/구독 정보를 바꿀 수 있다. 대상 행이 지금 owner면 애초에
-- 손 못 대고(using), 바꾼 결과값도 role은 user/admin만 허용된다(with check) — 이
-- 경로로는 절대 owner를 만들거나 owner를 건드릴 수 없다. RLS는 행 단위라 컬럼을
-- 가려낼 수는 없지만, subscription_* 컬럼만 바꾸는 UPDATE는 role 값이 그대로
-- user/admin 중 하나로 유지되므로 이 정책 하나로 이미 커버된다. admin/user는
-- is_owner()가 false이므로 role이든 구독 정보든 어떤 변경 시도도 RLS가 그냥 막는다.
create policy "owner가 다른 사용자의 role/구독 정보 관리" on profiles for update
using (is_owner() and role <> 'owner')
with check (is_owner() and role in ('user', 'admin'));

create policy "관리자 추가" on notes for insert with check (is_admin_or_owner());
create policy "관리자 수정" on notes for update using (is_admin_or_owner());
create policy "관리자 삭제" on notes for delete using (is_admin_or_owner());

-- 이메일로 사용자를 검색하는 용도(검색어를 비우면 전체 목록, 최대 200명).
-- auth.users는 PostgREST로 직접 조회할 수 없어서 security definer 함수로 우회하고,
-- 함수 안에서 호출자가 owner인지 다시 확인한다. 검색 대상에 profiles 행이 아직
-- 없으면(신규 가입자) 여기서 기본값 'user'로 만들어준다. 가입일(auth.users.created_at)과
-- 구독 정보도 함께 돌려줘서 admin.html 사용자 관리 화면에 한 번에 보여준다.
-- 주의: 리턴 컬럼 이름이 profiles 컬럼명(id/role 등)과 겹치면 별칭을 붙여도
-- "on conflict (id)"처럼 SQL 문법상 표현식이 아닌 자리에서까지 PL/pgSQL이 OUT 파라미터로
-- 오인해서 "column reference is ambiguous"가 난다 — 아예 겹치지 않는 이름(out_ 접두사)을 쓴다.
create or replace function admin_search_users(search_email text)
returns table (
  out_id uuid,
  out_email text,
  out_role text,
  out_created_at timestamptz,
  out_subscription_status text,
  out_subscription_started_at timestamptz,
  out_subscription_expires_at timestamptz,
  out_subscription_note text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role = 'owner') then
    raise exception 'owner 권한이 필요합니다';
  end if;

  insert into profiles (id, role)
  select u.id, 'user' from auth.users u
  where u.email ilike '%' || search_email || '%'
    and not exists (select 1 from profiles p2 where p2.id = u.id)
  on conflict (id) do nothing;

  return query
    select u.id, u.email::text, p.role, u.created_at,
           p.subscription_status, p.subscription_started_at, p.subscription_expires_at, p.subscription_note
    from auth.users u
    join profiles p on p.id = u.id
    where u.email ilike '%' || search_email || '%'
    order by u.email
    limit 200;
end;
$$;
grant execute on function admin_search_users(text) to authenticated;
