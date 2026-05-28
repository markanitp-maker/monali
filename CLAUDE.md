# CLAUDE.md — AI 맞춤형 가족 나들이 플래너

## 하네스: 가족 나들이 플래너

**목표:** 가족 제약조건(휠체어·유모차·식이 제한) 기반 무장애 나들이 코스를 AI로 자동 설계하고, 비회원 투표·PDF 출력·아카이브까지 end-to-end 개발 자동화

**트리거:** 나들이 플래너 개발, 기능 구현, 버그 수정, 모듈 추가, 재실행, 업데이트 요청 시 `family-outing-planner` 스킬을 사용하라. 단순 질문은 직접 응답 가능.

**변경 이력:**
| 날짜 | 변경 내용 | 대상 | 사유 |
|------|----------|------|------|
| 2026-05-28 | 초기 하네스 구성 | 전체 | 신규 프로젝트 |
| 2026-05-28 | D0 마이그레이션 전면 재작성 (15 테이블, Plan.md 기준) | migrations/001~003 | Plan.md 정합성 |
| 2026-05-28 | gemma4-integration 스킬 등록 | skills/gemma4-integration | GEMMA_SKILL.md 반영 |
| 2026-05-28 | ai-client.ts 재작성 (callWithBackoff, RateLimiter, extractJSON) | src/lib/ai-client.ts | GEMMA_SKILL 규칙 적용 |
| 2026-05-28 | ai-pipeline 에이전트 추가 | agents/ai-pipeline.md | 5단계 파이프라인 전담 |
| 2026-05-28 | course-generation 스킬 갱신 (gemma4-integration 참조) | skills/course-generation | GEMMA_SKILL 정합성 |
| 2026-05-28 | share-coordinator 에이전트 갱신 (item_id 투표, Silent Consent) | agents/share-coordinator.md | Plan.md FR-003 |
| 2026-05-28 | profile-manager 에이전트 갱신 (companions/groups 테이블 명) | agents/profile-manager.md | Plan.md 테이블 명 정합성 |
| 2026-05-28 | course-designer 에이전트 갱신 (202+Realtime, gemma4-integration) | agents/course-designer.md | Plan.md FR-002 |
| 2026-05-28 | profile-management 스킬 갱신 (companions/groups 구조) | skills/profile-management | Plan.md 테이블 명 정합성 |
| 2026-05-28 | share-voting 스킬 갱신 (item_id 투표, Silent Consent, ip_hash) | skills/share-voting | Plan.md FR-003 |
| 2026-05-28 | 오케스트레이터 갱신 (ai-pipeline 에이전트 추가, D1-D3 순차화) | skills/family-outing-planner | 신규 에이전트 반영 |
