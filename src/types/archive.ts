/**
 * Monali — Archive (나들이 아카이브) 공유 타입
 *
 * archive-manager 에이전트 관리.
 *
 * DB: outing_archives (plan_id UNIQUE, satisfaction_score, memo, accessibility_feedback JSONB)
 */

export interface AccessibilityFeedback {
  placeId: string;
  placeName: string;
  /** 실제로 휠체어/유모차 접근 가능했는지 */
  actualAccessible: boolean;
  notes?: string;
}

export interface OutingArchive {
  archive_id: string;
  outing_plan_id: string;
  /** 1 ~ 5 별점 */
  satisfaction_score: number;
  accessibility_feedback: AccessibilityFeedback[];
  memo?: string;
  photo_urls?: string[];
  completed_at: string;
}

/** POST /api/archive 요청 바디 */
export interface ArchiveUpsertRequest {
  planId: string;
  /** 1 ~ 5 */
  overallRating: 1 | 2 | 3 | 4 | 5;
  accessibilityFeedback: AccessibilityFeedback[];
  memo?: string;
  photoUrls?: string[];
}

export interface ArchiveUpsertResponse {
  archive: OutingArchive;
}

export interface ArchiveListResponse {
  archives: OutingArchive[];
  total: number;
}

/** 리스트 화면용 요약 (trips 조인) */
export interface ArchiveListItem extends OutingArchive {
  trip_title?: string;
  scheduled_date?: string | null;
  place_count?: number;
  thumbnail_url?: string | null;
}
