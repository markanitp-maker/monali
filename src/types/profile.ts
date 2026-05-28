/**
 * Monali 프로필/그룹 공유 타입
 *
 * profile-manager 에이전트 관리. course-designer 등 타 에이전트에서 import.
 *
 * ENUM 값은 supabase/migrations/001_initial_schema.sql 의 ENUM 정의와 1:1 일치 (대문자).
 *   - mobility_constraint_type : NONE | WHEELCHAIR | STROLLER | LIMITED
 *   - dietary_restriction_type : NONE | VEGETARIAN | VEGAN | HALAL | KOSHER | ALLERGY
 *   - digital_level_type       : HIGH | MID | LOW
 *
 * 테이블 명: companions (PK: profile_id), groups (PK: group_id), group_members (PK: id)
 */

// ─── ENUM 타입 (DB와 1:1) ────────────────────────────────────────────────────
export type MobilityConstraint = "NONE" | "WHEELCHAIR" | "STROLLER" | "LIMITED";

export type DietaryRestriction =
  | "NONE"
  | "VEGETARIAN"
  | "VEGAN"
  | "HALAL"
  | "KOSHER"
  | "ALLERGY";

export type DigitalLevel = "HIGH" | "MID" | "LOW";

export const MOBILITY_VALUES: readonly MobilityConstraint[] = [
  "NONE",
  "WHEELCHAIR",
  "STROLLER",
  "LIMITED",
] as const;

export const DIETARY_VALUES: readonly DietaryRestriction[] = [
  "NONE",
  "VEGETARIAN",
  "VEGAN",
  "HALAL",
  "KOSHER",
  "ALLERGY",
] as const;

export const DIGITAL_LEVEL_VALUES: readonly DigitalLevel[] = [
  "HIGH",
  "MID",
  "LOW",
] as const;

// ─── companions 테이블 모델 ─────────────────────────────────────────────────
export interface Companion {
  profile_id: string;
  user_id: string;
  name: string;
  mobility_constraint: MobilityConstraint;
  dietary_restriction: DietaryRestriction;
  digital_level: DigitalLevel;
  preference_tags: string[];
  allergies: string[];
  constraint_details: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** POST /api/profiles/companions 입력 단건 */
export interface CreateCompanionInput {
  name: string;
  mobility_constraint: MobilityConstraint;
  dietary_restriction: DietaryRestriction;
  digital_level: DigitalLevel;
  preference_tags?: string[];
  allergies?: string[];
  constraint_details?: Record<string, unknown>;
}

/** PATCH /api/profiles/companions/:id 입력 (부분 수정) */
export type UpdateCompanionInput = Partial<CreateCompanionInput>;

export interface CreateCompanionsRequest {
  companions: CreateCompanionInput[];
}

export interface CreateCompanionsResponse {
  companions: Companion[];
  updatedAt: string;
  /** digital_level === "LOW" 구성원 1명 이상이면 true */
  recommendSimpleView: boolean;
}

// ─── profiles (회원 본인) ───────────────────────────────────────────────────
export interface Profile {
  user_id: string;
  email: string;
  nickname: string | null;
  oauth_provider: string | null;
  credit_balance: number;
  created_at: string;
  updated_at: string;
}

export interface MeResponse {
  profile: Profile;
  companions: Companion[];
}

// ─── groups & group_members ─────────────────────────────────────────────────
export interface Group {
  group_id: string;
  user_id: string;
  name: string;
  color: string; // VARCHAR(7) HEX 예: "#3B82F6"
  created_at: string;
  updated_at: string;
}

export interface GroupMember {
  id: string;
  group_id: string;
  companion_id: string;
  created_at: string;
  companion?: Companion;
}

export interface CreateGroupInput {
  name: string;
  /** 7자리 HEX. 미지정 시 서버가 #3B82F6 기본값 부여 */
  color?: string;
}

export interface AddGroupMembersInput {
  companionIds: string[];
}

// ─── 유틸 ───────────────────────────────────────────────────────────────────
/** digital_level: "LOW" 구성원이 1명이라도 있으면 Simple View 권장. */
export const shouldUseSimpleView = (companions: Companion[]): boolean =>
  companions.some((c) => c.digital_level === "LOW");

/** UI 표시용 라벨 매핑 (한국어) */
export const MOBILITY_LABEL: Record<MobilityConstraint, string> = {
  NONE: "이동 제약 없음",
  WHEELCHAIR: "휠체어",
  STROLLER: "유모차",
  LIMITED: "보행 어려움",
};

export const DIETARY_LABEL: Record<DietaryRestriction, string> = {
  NONE: "식이 제한 없음",
  VEGETARIAN: "채식",
  VEGAN: "비건",
  HALAL: "할랄",
  KOSHER: "코셔",
  ALLERGY: "알러지",
};

export const DIGITAL_LEVEL_LABEL: Record<DigitalLevel, string> = {
  HIGH: "디지털 능숙",
  MID: "디지털 보통",
  LOW: "큰 화면 권장",
};
