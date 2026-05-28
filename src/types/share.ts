/**
 * Monali — Share / Voting 공유 타입
 *
 * share-coordinator 에이전트 관리. share-voting 스킬 패턴과 1:1 정합.
 *
 * 테이블 명 (001_initial_schema.sql 기준):
 *   - trips (plan_id PK, share_token, consensus_deadline)
 *   - plan_members (member_id, plan_id, guest_name, guest_token, ip_hash, is_agreed)
 *   - votes (vote_id, member_id, course_id, item_id, is_positive, comment) UNIQUE(member_id, item_id)
 *
 * 핵심 원칙 (Plan.md FR-003):
 *   - 투표 단위는 **item_id (장소)** — course_option 전체가 아님
 *   - 비회원 식별은 guest_token (UUID), 서버 세션 없음 (localStorage)
 *   - 마감 도래 시 is_agreed = NULL → true (Silent Consent)
 *   - 반대율 50%+ 장소는 AI 재추천 트리거 대상
 */

import type { CourseOption } from "./course";

// ─── Vote (votes 테이블 1:1) ────────────────────────────────────────────────
export interface Vote {
  vote_id: string;
  member_id: string;
  course_id: string;
  item_id: string; // 장소(itinerary_item) 단위 투표
  is_positive: boolean;
  comment?: string | null;
  created_at: string;
  updated_at?: string;
}

// ─── PlanMember (plan_members 테이블 1:1) ───────────────────────────────────
export interface PlanMember {
  member_id: string;
  plan_id: string; // = trip_id
  companion_id?: string | null;
  guest_name: string | null;
  guest_token: string;
  ip_hash: string | null;
  responded_at?: string | null;
  /** null = 미응답 (Silent Consent 대상), true = 동의, false = 거부 */
  is_agreed: boolean | null;
  created_at: string;
}

// ─── 합의 요약 ──────────────────────────────────────────────────────────────
export interface ConsensusSummary {
  total_members: number;
  responded: number;
  agreed: number;
  deadline: string;
  is_expired: boolean;
  /** 반대율 50% 이상으로 재추천 대상이 된 장소 item_id 목록 */
  rejected_item_ids: string[];
}

// ─── 장소별 투표 집계 ───────────────────────────────────────────────────────
export interface ItemVoteSummary {
  item_id: string;
  positive: number;
  negative: number;
  comments: { guest_name: string; text: string }[];
}

// ─── 공유 페이지 조회 응답 ──────────────────────────────────────────────────
export interface SharePageTripMeta {
  plan_id: string;
  title: string;
  scheduled_date: string | null;
  status: string;
  duration_days: number;
}

export interface SharePageData {
  plan: SharePageTripMeta;
  /** course_options + nested itinerary_items + places */
  courses: CourseOption[];
  /** ISO timestamp */
  consensusDeadline: string | null;
  /** 현재 방문자가 이미 등록된 경우 본인의 투표 내역 */
  your_responses: Vote[];
  /** 본인 정보 (guest_token 쿠키로 식별된 경우) */
  your_member?: Pick<PlanMember, "member_id" | "guest_name"> | null;
  /** 장소별 누적 투표 집계 (실시간 갱신 전 초기값) */
  vote_summaries: ItemVoteSummary[];
}

// ─── POST /api/trips/:planId/share ──────────────────────────────────────────
export interface CreateShareLinkRequest {
  /** 1 ~ 48 */
  consensusDeadlineHours: number;
}

export interface CreateShareLinkResponse {
  shareToken: string;
  shareUrl: string;
  consensusDeadline: string;
}

// ─── POST /api/share/:token/identify ────────────────────────────────────────
export interface IdentifyRequest {
  guest_name: string;
}

export interface IdentifyResponse {
  member_id: string;
  guest_token: string;
  is_returning: boolean;
}

// ─── POST /api/share/:token/vote ────────────────────────────────────────────
export interface VoteInput {
  course_id: string;
  item_id: string;
  is_positive: boolean;
  comment?: string;
}

export interface VoteRequest {
  guest_token: string;
  votes: VoteInput[];
}

export interface VoteResponse {
  saved_votes: Vote[];
  consensus_status: ConsensusSummary;
  /** upsert 결과 메시지 ("의견을 변경하셨습니다" 등) */
  message?: string;
}

// ─── 공통 에러 ──────────────────────────────────────────────────────────────
export interface ShareApiError {
  error: {
    code:
      | "SHARE_TOKEN_EXPIRED"
      | "SHARE_TOKEN_NOT_FOUND"
      | "VOTING_CLOSED"
      | "RATE_LIMITED"
      | "INVALID_GUEST_TOKEN"
      | "UNAUTHORIZED"
      | "VALIDATION_ERROR"
      | "INTERNAL_ERROR";
    message: string;
  };
}
