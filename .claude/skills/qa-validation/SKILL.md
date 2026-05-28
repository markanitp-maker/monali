---
name: qa-validation
description: API 응답 shape과 프론트엔드 타입의 경계면 교차 비교, 아키텍처 제약 준수 여부를 검증한다. DB GRANT 누락, Promise.all 금지 위반, SDK 구버전 사용, 타임아웃 로직 누락 등 검증 작업 시 반드시 이 스킬을 사용할 것.
---

## 검증 철학

"파일 존재 확인"이 아닌 **경계면 교차 비교**. Edge Function 응답 JSON과 프론트엔드 타입 파일을 동시에 읽고 shape 불일치를 찾는다. 전체 완성 후 1회가 아닌 **각 모듈 완성 직후 점진적으로 실행**한다.

## 검증 실행 패턴

### 1. 금지 패턴 Grep 검색
```
# 구버전 AI SDK 사용 여부
Grep: "@google/generative-ai" in supabase/functions/

# Promise.all 사용 여부 (금지)
Grep: "Promise\.all\(" in supabase/functions/
# Promise.allSettled는 허용
Grep: "Promise\.allSettled\(" in supabase/functions/  # 존재해야 함

# REST 직접 호출 여부
Grep: "generativelanguage.googleapis.com" in supabase/functions/
```

### 2. DB 스키마 검증
```
# GRANT ALL 누락 체크
Grep: "GRANT ALL ON public\." in supabase/migrations/
# 테이블 수와 GRANT 수 일치 확인 (9개 테이블 → 9개 GRANT)

# RLS 활성화 체크
Grep: "ENABLE ROW LEVEL SECURITY" in supabase/migrations/
```

### 3. 경계면 교차 비교
Edge Function 파일과 프론트 타입 파일을 동시에 읽는다:
```
Read: supabase/functions/profiles/index.ts  (응답 JSON 구조)
Read: src/types/profile.ts                  (프론트 타입)
→ 필드명, 타입, optional 여부 일치 확인
```

### 4. 타임아웃 로직 검증
```
Read: supabase/functions/planner/index.ts
→ setTimeout 또는 Promise.race 패턴 존재 여부
→ HARD_TIMEOUT_MS: 140000 이하 설정 여부
→ 부분 결과 반환 로직 존재 여부
```

## 심각도 분류

| 심각도 | 기준 | 조치 |
|--------|------|------|
| CRITICAL | 서비스 불가 (GRANT 누락, SDK 구버전, Promise.all 사용) | 즉시 해당 에이전트 SendMessage + 작업 중단 |
| WARNING | 품질 저하 (타임아웃 안전 마진 부족, 부분 결과 누락) | qa_report.md 기록 + 수정 권고 |
| INFO | 개선 권고 (선택적 필드 처리 개선, 에러 메시지 개선) | qa_report.md 기록 |

## QA 리포트 형식 (_workspace/qa_report.md)
```markdown
# QA 리포트 — {날짜}

## CRITICAL
- [ ] **[D2] Promise.all 사용**: `supabase/functions/planner/index.ts:45` — Promise.allSettled로 교체 필요
  - 수정: `Promise.all(places.map(...))` → `Promise.allSettled(places.map(...))`

## WARNING
- [ ] **[D2] 타임아웃 마진 부족**: `supabase/functions/planner/index.ts:12` — HARD_TIMEOUT_MS=145000 (140000 이하로 조정)

## INFO
- [ ] **[D1] 에러 메시지 개선**: `supabase/functions/profiles/index.ts:67` — Zod 에러를 사용자 친화적 메시지로 변환 권장

## 완료된 검증 항목
- [x] D0: GRANT ALL 9개 테이블 모두 존재 ✅
- [x] D0: RLS 9개 테이블 모두 활성화 ✅
- [x] D1: profile.ts ↔ profiles Edge Function shape 일치 ✅
```

## 재호출 시 동작
기존 `_workspace/qa_report.md` 읽고:
1. 이전 CRITICAL/WARNING 이슈 해결 여부 먼저 확인
2. 새 모듈에 대한 검증 추가
3. 해결된 항목 [x] 체크 업데이트
