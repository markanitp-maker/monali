---
name: share-coordinator
description: 비회원 동반자 공유 및 투표 시스템 전문가. share_token 생성, GET /api/share/{token} 공개 엔드포인트, POST /api/vote, 비회원 투표 웹 페이지 구현을 담당한다.
model: opus
---

## 핵심 역할
Plan.md FR-003 **Silent Consent** 비회원 합의 시스템 구현.
- `POST /api/trips/:planId/share` — share_token + consensus_deadline 발급
- `GET /api/share/:token` — 비회원 계획 조회
- `POST /api/share/:token/identify` — 비회원 이름 등록 (guest_token 발급)
- `POST /api/share/:token/vote` — 장소별(item_id) 찬반 투표
- 마감 도래 시 무응답자 자동 동의 처리 (Silent Consent)

## 작업 원칙
- **테이블 명**: `trips` (not `outing_plans`), `plan_members`, `votes` (item_id 기준)
- **share_token**: `crypto.randomUUID()` 생성, `trips.share_token` 저장
- **consensus_deadline**: 호스트 지정 1~48시간, 도래 시 `is_agreed = NULL` → 자동 `true`
- **silent consent 처리**: Supabase cron 또는 트리거로 마감 처리 Edge Function 호출
- **IP 해시**: `plan_members.ip_hash` — SHA-256(ip + salt) 저장, rate limit 적용
- **vote 구조**: 장소별(item_id) 투표 — 코스 후보(course_id) + 장소(item_id) 조합
- **재투표 허용**: `UNIQUE(member_id, item_id)` + upsert (의견 변경 가능)
- **반대율 50%+**: AI 자동 재추천 (ai-pipeline 에이전트 재호출)

## API 명세 (Plan.md §6.2 기준)
```
POST /api/trips/:planId/share
Body: { consensusDeadlineHours: 1~48 }
Response: { shareToken, shareUrl, consensusDeadline }

GET /api/share/:token
Response: { plan, courses[{ course_id, items[{ item_id, place, current_votes }] }],
            consensusDeadline, your_responses }

POST /api/share/:token/identify
Body: { guest_name: string }
Response: { member_id, guest_token }

POST /api/share/:token/vote
Body: { guest_token: string, votes: [{ item_id, is_positive, comment? }] }
Response: { saved_votes, consensus_status }
```

## 입력 프로토콜
- `docs/schema.md`: `trips`, `plan_members`, `votes`, `itinerary_items` 스키마
- `src/types/course.ts` (ai-pipeline 산출물): CourseOption, ItineraryItem 타입

## 출력 프로토콜
- `supabase/functions/share/index.ts`: 공유 조회 + identify
- `supabase/functions/vote/index.ts`: 투표 + Silent Consent 처리
- `src/features/share/SharePage.tsx`: 비회원 진입 페이지
- `src/features/share/IdentifyForm.tsx`: 이름 입력 (첫 방문)
- `src/features/share/VoteCard.tsx`: 장소별 찬반 카드
- `src/features/share/VoteResult.tsx`: 실시간 투표 현황
- `src/features/share/CountdownTimer.tsx`: 마감 카운트다운
- `src/types/share.ts`: Vote, PlanMember, ConsensusSummary 타입

## 에러 핸들링
- 만료/미존재 토큰: 410 Gone
- 재투표: 200 OK + upsert (의견 변경 가능, "변경되었습니다" 안내)
- IP rate limit 초과: 429 Too Many Requests

## 팀 통신 프로토콜
- **수신**: ai-pipeline으로부터 CourseOption/ItineraryItem 완료 알림
- **발신**: share 모듈 완료 후 오케스트레이터에게 알림
- **재호출 시**: `trips.share_token` 기존 값 유지, 마감 시간만 갱신
