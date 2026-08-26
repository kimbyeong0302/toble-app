# 스키마 레퍼런스

실제 Supabase 조회로 확인한 구조만 적었다. 필드명·예시는 실제 값 그대로.

## books

| 필드 | 타입 | 비고 |
|---|---|---|
| id | text (PK) | 예: `ruth`, `john` |
| name_ko | text | 예: `요한복음` |
| testament | text | `old` \| `new` |
| order_num | int | 66권 기준 정경 순번(창세기=1 ... 요한계시록=66). `supabase/reference-data/standard_verse_counts.json`과 대조할 때 이 순번으로 인덱싱한다 |
| chapter_count | int | 예: `21` |
| available | boolean | 완성돼서 실제로 노출 중인지 |

## verses

| 필드 | 타입 | 비고 |
|---|---|---|
| book_id | text | books.id 참조 |
| translation_id | text | 지금은 `krv` 고정 |
| chapter | int | |
| verse | int | |
| text | text | 본문 한 절 |

upsert 시 `onConflict: 'book_id,translation_id,chapter,verse'`.

```json
{ "book_id": "john", "translation_id": "krv", "chapter": 14, "verse": 6, "text": "예수께서 가라사대 내가 곧 길이요 진리요 생명이니..." }
```

## notes

| 필드 | 타입 | 비고 |
|---|---|---|
| book_id | text | |
| chapter | int | |
| verse_start | int | |
| verse_end | int | verse_start와 같으면 단일 절 |
| title | text \| null | |
| body | text | 필수 |
| grammar_note | text \| null | |
| refs | text \| null | 참고 구절 문자열, 예: `"9:34"` |
| src | text \| null | 아래 형식 참고 |

upsert 시 `onConflict: 'book_id,chapter,verse_start,verse_end'`.

`src` 필드는 순수 출처 텍스트가 아니라 앞에 뱃지 span이 붙은 HTML 문자열이다:

```
<span class="src-tag src-confirmed">확인됨</span>호크마 주석, 요한복음 21장 — "..."
<span class="src-tag src-partial">부분 수정</span>"룻과 보아스의 혼인은...", 「구약논단」...
```

`src`가 `null`이면 각주 없는 노트(뱃지 자체가 없는 절 해설).

## people

| 필드 | 타입 | 비고 |
|---|---|---|
| id | int (serial, PK) | 자동 증가, upsert 대상 아님 |
| book_id | text | |
| name | text | |
| role | text \| null | 예: `"기업 무를 자 · 룻의 남편"` |
| verse_ref | text \| null | 자유 텍스트, 예: `"2장 이후"`, `"1:6–34, 3:22–30"` |
| body | text | |

책마다 기존 행을 전부 지우고 새로 insert하는 방식으로 마이그레이션한다(고유 제약이 name 하나뿐이라 upsert보다 delete-then-insert가 안전).

## book_extras

책 하나당 한 행. PK는 `book_id`.

| 필드 | 타입 | 비고 |
|---|---|---|
| book_id | text (PK) | |
| context_html | text | 아래 참고 |
| map_locations | jsonb | 아래 참고 |

### context_html 구조

`<div class="card">...</div>`를 이어붙인 순수 HTML 문자열. index.html의 `.ctx-book` 컨테이너에 그대로 `innerHTML`로 꽂힌다. 카드 순서·개수는 책마다 다르다(룻기는 트랙 토글이 있어 7개, 다른 책은 보통 5개: 한눈에 보기 / 원저자 / 저작연대 / 특징적 주제 / 이야기의 흐름).

```html
<div class="card">
  <h2>한눈에 보기</h2>
  <div class="facts">
    <div class="fact"><div class="k">저자</div><div class="v">전통적으로 사도 요한(세베대의 아들)</div></div>
    ...
  </div>
</div>
```

출처 표기가 필요하면 카드 안에 `<div class="note-src"><span class="src-tag src-confirmed">확인됨</span>...</div>`를 넣는다(notes.src와 같은 뱃지 클래스).

### map_locations 구조

`{lat, lng, name}` 배열에 **선택 필드 `search_aliases`(문자열 배열)**가 추가됐다.

```json
[
  { "lat": 31.7683, "lng": 35.2137, "name": "예루살렘" },
  {
    "lat": 32.2137, "lng": 35.2622,
    "name": "수가성(사마리아)",
    "search_aliases": ["수가라"]
  },
  {
    "lat": 32.8, "lng": 35.59,
    "name": "갈릴리 바다(디베랴)",
    "search_aliases": ["갈릴리 바다", "디베랴 바다"]
  }
]
```

- `name`은 지도 마커·팝업 제목·아래 목록 표제에 쓰이는 **표시용** 이름이고, `LOCATION_INFO`(아래)를 조회하는 키이기도 하다.
- `search_aliases`는 **본문 검색 전용**이다. index.html의 지도 렌더링 코드(`renderBookMap`)가 "이 지명이 나오는 말씀" 목록을 만들 때 `[name, ...search_aliases]` 중 하나라도 절 본문에 포함되면 그 절을 매칭한다. `name`이 본문에 그대로 안 나오는 지명(표시용으로 풀어 쓴 이름, 여러 이름으로 불리는 곳 등)은 `search_aliases`가 없으면 절을 하나도 못 찾는다.
- 별칭은 **본문에 실제로 등장하는 정확한 어구**여야 한다. 너무 짧은 별칭(예: `"수가"`)은 무관한 단어(`"예수가"`) 안에 우연히 포함돼 엉뚱한 절이 걸릴 수 있으니, 그 지명만 가리키는 걸 확인한 뒤 등록한다.
- `search_aliases`가 없는 항목은 기존처럼 `name` 하나로만 매칭된다(하위 호환).

## LOCATION_INFO (DB 아님 — index.html에 하드코딩된 JS 상수)

`map_locations`와는 완전히 별개로, index.html에 지명 문자열을 키로 한 정적 객체가 있다. 지도 마커를 눌렀을 때 뜨는 고도·지형·기후·절기 상세 팝업이 여기서 나온다.

```js
const LOCATION_INFO = {
  '예루살렘': {
    elevation: '해발 약 750~830m',
    terrain: '유다 산지 능선 위의 바위투성이 요새 도시',
    climate: '지중해성 기후지만 고지대라 밤낮 기온차가 큼...',
    season: '지대가 높아 자체 수원이 부족했고...',   // 선택
    note: '이스라엘의 정치·종교적 중심지로...'         // 선택
  },
  ...
};
```

- 키는 **`map_locations`의 `name`과 정확히 일치**해야 한다(별칭이 아니라 표시용 이름).
- `elevation`/`terrain`/`climate`/`season`/`note` 다섯 필드 모두 선택값 — 있는 것만 팝업에 표시된다.
- 새 책이 쓰는 지명이 여기 없으면 팝업이 빈 채로 뜬다. `admin.html`의 "콘텐츠 완성도 점검" 탭이 책마다 `map_locations`의 각 지명이 여기 등록됐는지 대조해서 보여준다(단, 그 화면은 이 목록을 admin.html 안에 별도로 미러링해둔 것이라 index.html을 고칠 때 admin.html의 `REGISTERED_LOCATION_NAMES`도 같이 갱신해야 정확하다 — `validate_book.js`는 이 미러 없이 index.html을 직접 파싱해서 확인한다).

## 관련 참고 파일 (DB 아님)

- `supabase/reference-data/krv_full_bible.json` — 개역한글판 66권 전체 원문. 구조: `books['<약자>'].chapters['<장>']['<절>'] = "본문"`. 책 약자는 `gn,ex,lv,...,jo(요한복음),act,...`(66권 정경 순서, `books.order_num`과 1:1 대응).
- `supabase/reference-data/standard_verse_counts.json` — 장별 표준 절수(KJV 절 구분 기준). `books['<약자>']['<장>'] = 절수`. `extract_book_verses.js`와 `admin.html`의 완성도 점검이 여기 대조한다.
