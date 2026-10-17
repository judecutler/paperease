# CareLoop AI (해커톤 MVP)

Less chasing. More caring. 캘리포니아 HCO용 케어기버 서류 수집 에이전트입니다. PRD의 P0 흐름 전체(공백 탐지, SMS 요청, 사진 수집, AI 추출, 후속 질문, 관리자 승인, 감사 로그)가 API 키 없이도 끝까지 돌아갑니다.

## 실행

```bash
npm install
npm run dev        # http://localhost:3000
```

데이터는 `data/db.json`에 저장되고, 처음 실행하면 샘플 케어기버 6명으로 채워집니다. 초기화는 Rules 화면의 **Reset demo data** 또는 `npm run reset`.

## 데모 시나리오 (PRD 7장, Maria)

1. 대시보드에서 Maria Lopez의 Entry training이 **Missing**. 행을 눌러 상세로 이동.
2. **Ask agent to request** → 에이전트가 SMS 발송, 상태 **Requested**.
3. 오른쪽 폰에서 Maria로 **Training certificate, hours not shown (Maria)** 사진 전송 → AI가 4개 필드 추출, 시간이 없어서 후속 질문, 상태 **Following up**.
4. `It was 5 hours` 칩으로 답장 → 에이전트가 답장에서 시간을 읽고 레코드 준비, 상태 **Pending review**.
5. 각 필드를 **Verify** 또는 **Correct** → 모두 확인되면 **Approve record** 활성화 → **Approved**. 감사 로그에 전 과정이 시간순으로 남습니다.

예외 처리(FR-07)도 바로 보여줄 수 있습니다.
- Luis: 흐릿한 사진으로 이미 **Escalated** 상태. 다시 요청 후 "HCA registration, clear photo" 전송.
- 다른 사람 이름의 서류 전송 → 이름 불일치로 에스컬레이션.
- `I did 3 hours` → 최소 5시간 미달로 에스컬레이션.
- 엉뚱한 서류(TB 결과를 교육 수료증 대신) → 올바른 서류를 다시 요청.
- `STOP` → 수신 거부 처리, 열린 요청은 직원에게 넘김.
- Ana, Luis는 스페인어로 대화(P1 다국어).

## AI 연결

`.env.local`에 키를 넣으면 실제 모델을 씁니다(`.env.example` 참고). 키가 없거나 호출이 실패하면 항상 결정적인 대체 동작으로 돌아갑니다.

| 기능 | 키가 있을 때 | 키가 없을 때 |
| --- | --- | --- |
| 서류 추출 | Claude(`claude-opus-5-5`) 비전 + 구조화 출력. 샘플 PNG와 업로드 사진을 실제로 읽음 | 샘플 서류마다 미리 정한 추출 결과. 직접 올린 사진은 사람이 읽도록 에스컬레이션 |
| SMS 문구 | Claude가 템플릿을 바탕으로 작성 | 영어/스페인어 템플릿 |
| 후속 질문 문구 | RunAnywhere(OpenAI 호환) 설정 시 RunAnywhere, 아니면 Claude | 템플릿 |
| 답장 해석 | Claude | 숫자/날짜 규칙 |

SMS는 시뮬레이션입니다. Twilio를 붙이려면 `lib/agent.ts`의 `Ctx.sms()` 한 곳에서 발송하고, 수신 웹훅을 `caregiver-reply` 액션으로 넘기면 됩니다.

## 구조

- `lib/agent.ts`: 에이전트 워크플로와 모든 액션(공백 탐지, 요청, 답장 처리, 검증, 승인, 반려, 규칙 변경)
- `lib/llm.ts`: Claude / RunAnywhere 호출과 대체 동작
- `lib/seed.ts`: 캘리포니아 HCO 체크리스트(데모용, 공식 요건과 대조 필요)와 샘플 데이터
- `lib/db.ts`: JSON 저장소. `load()`/`save()`만 바꾸면 Supabase로 교체 가능(`supabase/schema.sql`)
- `components/ui.tsx`: 디자인 시스템 레퍼런스 컴포넌트의 TSX 포팅
- `app/tokens.css`, `app/components.css`: `/design-system`에서 복사한 토큰과 컴포넌트 CSS
- `scripts/make-samples.mjs`: 샘플 서류 이미지 생성(Playwright)

## 지킨 원칙

- 사람이 모든 필드를 확인하기 전에는 승인 버튼이 비활성화됩니다. 에이전트는 레코드를 스스로 승인하지 않습니다.
- AI 추출값과 SMS 답장 값은 파란색(agent) 스타일, 사람이 확인한 값만 초록색입니다.
- 신원조회(Live Scan)는 SMS로 요청하지 않습니다. 민감한 식별자를 문자로 묻지 않습니다.
- 원본 서류와 이전 제출본은 지우지 않고 남깁니다.
