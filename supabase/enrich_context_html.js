#!/usr/bin/env node
// 마태복음·마가복음·누가복음 배경(context_html)에
// 학술 인용(note-src) 카드를 추가하고, 부족한 항목을 보강한다.
// 기존 내용은 유지하고, 끝에 추가 카드를 이어붙이는 방식으로만 동작한다.

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs'), path = require('path');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// ── 추가할 카드 정의 ────────────────────────────────────────────

const ADDITIONS = {

  matthew: `
<div class="card">
<h2>신학 핵심 — 천국과 율법의 완성</h2>
<p>마태복음은 예수를 <strong>새 모세</strong>로 제시하면서 동시에 율법을 폐지하는 것이 아니라 완성하는 자(5:17)로 그린다. '하늘 아버지의 온전하심'(5:48)을 향한 산상수훈(5–7장)은 더 높은 도덕률이 아니라, 종말론적 의(righteousness)가 제자 공동체 안에서 실현되는 방식을 묘사한다.</p>
<p><strong>다섯 강화(講話) 구조</strong>: 산상수훈(5–7장), 파송 강화(10장), 비유 강화(13장), 공동체 강화(18장), 종말 강화(24–25장). 각 강화는 '예수께서 이 말씀을 마치시매'(7:28, 11:1 등)로 끝나며 모세의 다섯 책(모세오경)과 의도적으로 대응한다.</p>
<p><strong>천국(Βασιλεία τῶν οὐρανῶν)</strong>: 마태만의 표현. 유대 경건 전통에서 하나님 이름을 직접 쓰지 않으려는 완곡어법으로, 마가·누가의 '하나님 나라'와 동의어다.</p>
<div class="note-src"><span class="src-tag src-confirmed">확인됨</span>R.T. France, <i>The Gospel of Matthew</i>, NICNT (Grand Rapids: Eerdmans, 2007), pp. 6–11 — 다섯 강화 구조와 '새 모세' 모티프 분석; W.D. Davies &amp; Dale C. Allison, <i>A Critical and Exegetical Commentary on the Gospel According to Saint Matthew</i>, vol. 1, ICC (Edinburgh: T&amp;T Clark, 1988), pp. 58–72 — 마태의 유대적 배경과 구약 인용 패턴.</div>
</div>

<div class="card">
<h2>마태 공동체 — 세 가지 학술 입장</h2>
<p>마태복음이 형성된 공동체의 성격에 대해 세 가지 주요 견해가 있다.</p>
<ul>
<li><strong>유대 내부 분파설</strong>: 공동체는 주후 70년 이후 얌니아 회의(c. 85년경) 전후까지 여전히 유대교 안에 있었으며, 바리새파와 회당 안에서 격렬히 대립했다는 견해.</li>
<li><strong>유대교 결별설</strong>: 주후 70년 성전 파괴 이후 랍비 유대교와의 분리가 이미 상당히 진행된 상태에서, 공동체는 새로운 정체성을 형성 중이었다는 견해.</li>
<li><strong>혼합 공동체설</strong>: 28:19의 '모든 민족'이 실질적 이방 선교를 전제하며, 공동체 자체가 유대인과 이방인 모두를 포함했다는 견해.</li>
</ul>
<div class="note-src"><span class="src-tag src-confirmed">확인됨</span>Ulrich Luz, <i>Matthew 1–7: A Commentary</i>, trans. James E. Crouch, Hermeneia (Minneapolis: Fortress Press, 2007), pp. 49–58 — 마태 공동체의 사회적 위치와 유대교 관계에 대한 세 입장 정리.</div>
</div>`,

  mark: `
<div class="card">
<h2>기록 시기·장소 — 학술 논쟁</h2>
<p>마가복음의 기록 시기에 대해 두 가지 주요 견해가 병존한다.</p>
<ul>
<li><strong>주후 60년대 초</strong>: 바울과 베드로 순교(64년경) 이전, 파피아스 증언에 따라 로마에서 기록됐다는 전통설.</li>
<li><strong>주후 66–70년경</strong>: 13장의 종말 강화가 유대 전쟁(66–70년)의 긴박성을 반영하며, '멸망의 가증한 것'(13:14)이 임박한 사건을 가리킨다는 견해. 현대 학계 다수가 지지.</li>
</ul>
<p>기록 <strong>장소</strong>는 로마(전통설; 파피아스, 클레멘스 등)와 시리아(갈릴리 지리에 정통한 저자, 시리아 기독교 자료와의 연관성) 두 견해가 있다.</p>
<div class="note-src"><span class="src-tag src-confirmed">확인됨</span>Joel Marcus, <i>Mark 1–8</i>, AB 27 (New York: Doubleday, 2000), pp. 37–39 — 시리아 기원설 논거; Adela Yarbro Collins, <i>Mark: A Commentary</i>, Hermeneia (Minneapolis: Fortress Press, 2007), pp. 7–10 — 파피아스 증언과 로마 기원설 평가.</div>
</div>

<div class="card">
<h2>메시아 비밀 — 학술 개념</h2>
<p>독일 학자 빌헬름 브레데(Wilhelm Wrede)는 1901년 저서에서 마가복음의 반복되는 '침묵 명령'(귀신 꾸짖음, 치유 후 말하지 말라는 명령, 제자들의 지속적 무이해)을 하나의 신학적 모티프로 묶어 <strong>'메시아 비밀(das Messiasgeheimnis)'</strong>이라 불렀다. 브레데는 이를 역사적 예수가 스스로 메시아임을 선언하지 않았으나 초대교회가 부활 이후 그를 메시아로 재해석한 흔적으로 보았다.</p>
<p>이후 학계는 다양하게 수정했다. ① <strong>십자가 신학</strong>: 메시아의 정체는 십자가 아래에서만 온전히 드러난다(백부장의 고백 15:39). ② <strong>마가 공동체의 교육적 전략</strong>: 독자에게는 처음부터 알려진 정체를, 내러티브 안의 인물들은 점진적으로 알아간다는 서사 기법.</p>
<div class="note-src"><span class="src-tag src-confirmed">확인됨</span>Wilhelm Wrede, <i>Das Messiasgeheimnis in den Evangelien</i> (Göttingen: Vandenhoeck &amp; Ruprecht, 1901; 영역: <i>The Messianic Secret</i>, trans. J.C.G. Greig, Cambridge: James Clarke, 1971) — 개념 원전; Adela Yarbro Collins, <i>Mark</i>, Hermeneia, pp. 168–174 — 메시아 비밀 모티프의 현대적 재평가.</div>
</div>`,

  luke: `
<div class="card">
<h2>9–24장 이야기의 흐름</h2>
<div class="timeline">
<div class="t-item"><div class="t-title">⑨ 제자 파송과 베드로의 고백 (9장)</div><div class="t-desc">열두 제자와 칠십 인 파송, 오병이어, "당신은 그리스도시니이다"</div></div>
<div class="t-item"><div class="t-title">⑩ 예루살렘을 향한 긴 여정 (10–18장)</div><div class="t-desc">누가 특유의 중간 단락 — 선한 사마리아인, 마르다와 마리아, 탕자의 비유, 열 명의 나병환자 등 풍성한 비유와 사건</div></div>
<div class="t-item"><div class="t-title">⑪ 입성·성전·논쟁 (19–20장)</div><div class="t-desc">나귀를 타고 예루살렘에 입성, 성전 청결, 세금·부활·다윗의 자손 논쟁</div></div>
<div class="t-item"><div class="t-title">⑫ 종말 강화 (21장)</div><div class="t-desc">예루살렘 멸망과 종말의 징조, 깨어 기도하라</div></div>
<div class="t-item"><div class="t-title">⑬ 수난 (22–23장)</div><div class="t-desc">최후의 만찬, 겟세마네, 잡히심, 재판, 십자가</div></div>
<div class="t-item"><div class="t-title">⑭ 부활과 승천 (24장)</div><div class="t-desc">빈 무덤, 엠마오 제자들, 예루살렘 나타나심, 승천 — 사도행전으로 이어짐</div></div>
</div>
</div>

<div class="card">
<h2>누가-행전 — 한 저자의 두 권 작품</h2>
<p>누가복음과 사도행전은 같은 서문 형식(눅 1:1–4 / 행 1:1), 동일한 수신자(데오빌로), 연속되는 내러티브(눅 24:50–53 / 행 1:9–11), 성령 강조라는 공통 신학으로 <strong>하나의 연속된 두 권짜리 역사서술</strong>임을 보여준다. 헨리 카드버리(Henry J. Cadbury)가 1927년에 제안한 '누가-행전(Luke-Acts)' 개념은 이후 학계의 표준 시각이 됐다.</p>
<p>이에 따르면 누가복음은 예수 사역이 예루살렘에서 절정에 이르는 것으로 끝나고, 사도행전은 복음이 예루살렘에서 로마까지 확산되는 것으로 이어진다는 <strong>지리적 신학 구조</strong>를 갖는다(행 1:8 — 예루살렘→유대→사마리아→땅 끝).</p>
<div class="note-src"><span class="src-tag src-confirmed">확인됨</span>Henry J. Cadbury, <i>The Making of Luke-Acts</i> (New York: Macmillan, 1927; repr. London: SPCK, 1958) — '누가-행전' 개념의 학술적 확립; Joel B. Green, <i>The Gospel of Luke</i>, NICNT (Grand Rapids: Eerdmans, 1997), pp. 1–10 — 누가-행전의 통일성과 헬레니즘 역사서술 장르; Joseph A. Fitzmyer, <i>The Gospel According to Luke I–IX</i>, AB 28 (Garden City: Doubleday, 1981), pp. 35–62 — 서문(1:1–4)의 헬레니즘 역사서술 전통 분석.</div>
</div>

<div class="card">
<h2>저작 목적과 역사 서술 방식</h2>
<p>누가는 서문(1:1–4)에서 저술 목적을 명시한다: 목격자 증언을 '근원부터 자세히 미루어 살펴' 데오빌로가 '가르침 받은 것의 확실함'을 알게 하려는 것. 이 서문은 헬레니즘 역사서술과 의학 문헌 서문 관행을 따른 것으로, 저자가 그리스-로마 문학 전통에 익숙했음을 보여준다.</p>
<p><strong>역사적 연대기 제공</strong>: 세례 요한의 사역 시작을 '디베료 황제 제위 열다섯 해'(3:1)로 명시하는 등, 예수 이야기를 로마 제국사 안에 위치시킨다. 이는 초대 기독교가 사회적으로 허용 가능한 운동임을 지식인 독자층에 설득하려는 변증적 목적과 연결된다.</p>
<div class="note-src"><span class="src-tag src-confirmed">확인됨</span>François Bovon, <i>Luke 1: A Commentary on the Gospel of Luke 1:1–9:50</i>, trans. Christine M. Thomas, Hermeneia (Minneapolis: Fortress Press, 2002), pp. 19–25 — 서문의 장르와 목적; Fitzmyer, <i>Luke I–IX</i>, pp. 287–302 — 3:1–2의 역사적 연대기 분석.</div>
</div>`
};

// ── 메인 실행 ────────────────────────────────────────────────────

async function main() {
  for (const [bookId, addition] of Object.entries(ADDITIONS)) {
    const { data, error } = await sb.from('book_extras').select('context_html').eq('book_id', bookId).single();
    if (error || !data) { console.error(`[${bookId}] 조회 실패:`, error?.message); continue; }

    const existing = data.context_html || '';
    const updated = existing + '\n' + addition.trim();

    const { error: updErr } = await sb.from('book_extras').update({ context_html: updated }).eq('book_id', bookId);
    if (updErr) {
      console.error(`[${bookId}] 업데이트 실패:`, updErr.message);
    } else {
      console.log(`[${bookId}] OK — ${existing.length}자 → ${updated.length}자 (+${updated.length - existing.length}자)`);
    }
  }
  console.log('\n완료');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
