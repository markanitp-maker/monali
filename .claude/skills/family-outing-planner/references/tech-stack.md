# 기술 스택 및 아키텍처 제약

## 고정 기술 스택

### Frontend
- **React + Vite + TypeScript** (strict mode)
- **Tailwind CSS** — 유틸리티 클래스, 모바일 우선
- **Lucide React** — 아이콘 라이브러리
- **배포**: Vercel

### Backend
- **Supabase** — PostgreSQL + Deno Edge Functions + Realtime + Storage
- Edge Function 런타임: Deno, TypeScript

### AI
- **@google/genai SDK** (신버전) — 유일한 AI SDK
  - 임포트: `import { GoogleGenAI } from "@google/genai";`
  - ❌ 금지: `@google/generative-ai` (구버전)
  - ❌ 금지: REST 직접 호출
- **모델 폴백**: 기본 모델 → gemma-4-31b-it

### 인증
- Supabase Auth (이메일/소셜)
- 비회원: share_token 기반 인증 없는 접근

---

## 아키텍처 제약 (절대 준수)

### Edge Function 제약
| 제약 | 값 | 이유 |
|------|----|------|
| 타임아웃 | 150초 (안전 마진: 140초) | Supabase Edge Function 하드 리밋 |
| AI 타임아웃 | 140초 이내 처리 | 10초 안전 마진 |
| 토큰 제한 | [6000] 토큰 | AI API 비용 및 안정성 |

### 비동기 처리
- **Promise.allSettled만 사용** — `Promise.all` 금지
  - 이유: 외부 API 단일 실패가 전체 코스 생성을 막지 않도록
  - 적용: 외부 API 병렬 호출, 사진 업로드, 피드백 루프 모두

### DB 규칙
- 모든 테이블: `GRANT ALL ON public.<테이블명> TO anon, authenticated;`
- 모든 테이블: `ALTER TABLE public.<테이블명> ENABLE ROW LEVEL SECURITY;`
- 이유: GRANT 없으면 비회원 투표 불가, RLS 없으면 보안 취약

### 개발 사이클
- **D0-D7 주간 런치 사이클** 준수
  - D0: DB 스키마 + 프로젝트 설정
  - D1: 프로필 관리
  - D2: AI 코스 설계
  - D3: 비회원 공유/투표
  - D4: 일정표 렌더링 + PDF
  - D5: 아카이브
  - D6: 구독/결제 (Phase 2)
  - D7: QA + 배포

---

## 디렉토리 구조

```
E:\VibeCoding\Monali\
├── src/
│   ├── features/
│   │   ├── profile/          # D1
│   │   ├── planner/          # D2
│   │   ├── share/            # D3
│   │   ├── itinerary/        # D4
│   │   └── archive/          # D5
│   ├── lib/
│   │   └── ai-client.ts      # @google/genai 클라이언트
│   └── types/
│       ├── profile.ts        # MemberProfile 공유 타입
│       ├── course.ts         # CourseOption, Place, ItineraryItem
│       ├── share.ts          # Vote, VoteSummary
│       └── archive.ts        # OutingArchive
├── supabase/
│   ├── migrations/
│   │   ├── 001_initial_schema.sql
│   │   └── 002_rls_policies.sql
│   └── functions/
│       ├── profiles/
│       ├── planner/
│       ├── share/
│       ├── vote/
│       ├── itinerary-export/
│       └── archive/
├── docs/
│   └── schema.md             # DB 스키마 다이어그램
└── _workspace/
    └── qa_report.md          # QA 리포트 (중간 산출물)
```

---

## 환경 변수

```env
# Supabase
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# AI
GEMINI_API_KEY=
GEMINI_PRIMARY_MODEL=gemini-2.0-flash

# App
PUBLIC_URL=https://your-app.vercel.app
```
