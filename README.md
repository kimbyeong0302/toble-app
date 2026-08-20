# 토블 : 성경을 톺아보다 — 앱화 가이드

이 폴더는 Claude Code로 바로 배포할 수 있도록 준비된 PWA(프로그레시브 웹 앱) 프로젝트입니다.

```
toble-app/
├── index.html      ← 룻기 학습 앱 본체
├── manifest.json   ← 앱 이름·아이콘·실행 방식 정의
├── sw.js           ← 오프라인에서도 열리게 해주는 서비스 워커
├── icons/
│   ├── icon-192.png
│   └── icon-512.png
└── README.md       ← 이 파일
```

## 1. Claude Code 설치 (컴퓨터에 한 번만)

터미널(Mac/Linux)에서:
```
curl -fsSL claude.ai/install.sh | bash
```
Windows PowerShell에서:
```
irm https://claude.ai/install.ps1 | iex
```

## 2. 이 폴더에서 Claude Code 실행

터미널에서 이 `toble-app` 폴더로 이동한 뒤:
```
cd toble-app
claude
```

## 3. Claude Code에게 배포를 요청

대화창이 열리면 이렇게 요청하세요 (그대로 복사해서 붙여넣으셔도 됩니다):

> 이 폴더를 GitHub 저장소로 만들고, GitHub Pages로 배포해줘. 저장소 이름은 toble-app으로 하고, 배포되면 실제 접속 주소를 알려줘.

Claude Code가 다음을 대신 해줍니다:
- `git init`, `git add`, `git commit`
- GitHub 저장소 생성 (GitHub 계정 로그인을 요청할 수 있습니다 — 없으면 github.com에서 무료로 만들어주세요)
- GitHub Pages 활성화
- 배포 후 실제 URL 안내 (예: `https://아이디.github.io/toble-app/`)

## 4. 아이패드/아이폰에서 설치

1. Safari로 안내받은 주소에 접속
2. 하단 공유 버튼(⬆️) → **"홈 화면에 추가"**
3. 홈 화면에 "토블" 아이콘이 생기고, 탭하면 주소창 없이 전체 화면 앱처럼 실행됩니다.

## 이후 내용을 수정하고 싶을 때

`index.html`을 고친 뒤, Claude Code에게:
> 변경사항을 커밋하고 GitHub Pages에 다시 배포해줘.

라고 하면 됩니다. 배포된 주소는 그대로 유지되고 내용만 갱신됩니다.

## 참고

- 이 프로젝트는 룻기(4장)만 들어있는 프로토타입입니다. 다른 책을 추가하려면 `index.html` 안의 `NOTES_RUTH`, 본문 HTML, 지도 SVG 등을 확장하면 됩니다.
- 하이라이트·학습 기록·메모는 브라우저의 localStorage에 저장됩니다. `https://` 주소로 열면(로컬 file://와 달리) 이 저장이 훨씬 안정적으로 유지됩니다.
- 무료 요금제로 충분합니다 — GitHub Pages, Claude Code 모두 이 규모의 개인 프로젝트에는 비용이 들지 않습니다(Claude 사용량 자체의 요금제는 별개입니다).
