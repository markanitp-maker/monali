import { useMemo } from "react";
import { Accessibility, Baby, MapPin, Phone, Navigation } from "lucide-react";
import type { CourseOption, ItineraryItem, Trip } from "@/types/course";
import { PrintButton } from "./PrintButton";
import { ViewToggle, type ItineraryViewMode } from "./ViewToggle";

interface SimpleViewProps {
  trip: Trip;
  course: CourseOption;
  onSwitchMode: (mode: ItineraryViewMode) => void;
  onStart?: () => void;
  starting?: boolean;
}

/**
 * 단순화 뷰 — 어르신/디지털 약자 전용.
 *
 * 디자인 원칙:
 *  - 최소 24px (text-2xl), 장소명 36px (text-4xl)
 *  - 고대비 (gray-900 on white)
 *  - 단일 컬럼 스크롤, 한 화면당 정보 밀도 낮음
 *  - 큰 탭 영역: 전화 / 길찾기 버튼
 *  - 아이콘 + 텍스트 병기 (아이콘 단독 사용 금지)
 *
 * ItineraryView 와 props/state 공유하지 않는 완전 독립 컴포넌트.
 */
export const SimpleView = ({
  trip,
  course,
  onSwitchMode,
  onStart,
  starting = false,
}: SimpleViewProps) => {
  const sortedItems = useMemo(
    () =>
      course.items.slice().sort((a, b) => a.sequence_order - b.sequence_order),
    [course.items],
  );

  return (
    <div className="simple-view min-h-screen bg-white text-gray-900">
      <div className="mx-auto max-w-2xl px-4 py-6">
        {/* 상단 컨트롤 */}
        <div className="no-print mb-6 flex items-center justify-between gap-3">
          <ViewToggle mode="simple" onChange={onSwitchMode} />
          <PrintButton
            planId={trip.plan_id}
            scheduledDate={trip.scheduled_date}
            size="large"
          />
        </div>

        {/* 헤더 */}
        <header className="mb-8 rounded-2xl border-2 border-gray-900 bg-white p-6">
          <h1 className="text-4xl font-bold leading-tight text-gray-900">
            {trip.title}
          </h1>
          {trip.scheduled_date && (
            <p className="mt-3 text-2xl text-gray-900">
              날짜: <strong>{formatDateKR(trip.scheduled_date)}</strong>
            </p>
          )}
          <p className="mt-2 text-2xl text-gray-900">
            총 장소: <strong>{sortedItems.length}곳</strong>
          </p>
        </header>

        {/* 출발 버튼 (시작 전) */}
        {!trip.started_at && onStart && (
          <button
            type="button"
            onClick={onStart}
            disabled={starting}
            className="no-print mb-8 w-full rounded-2xl bg-green-600 px-6 py-6 text-3xl font-bold text-white shadow-md hover:bg-green-700 disabled:bg-gray-400"
          >
            {starting ? "출발 처리 중..." : "지금 출발하기"}
          </button>
        )}
        {trip.started_at && (
          <p className="mb-6 rounded-2xl bg-green-50 px-4 py-3 text-center text-2xl font-semibold text-green-800">
            출발 완료
          </p>
        )}

        {/* 장소 카드 목록 */}
        <ol className="space-y-6">
          {sortedItems.map((item) => (
            <SimplePlaceCard key={item.item_id} item={item} />
          ))}
        </ol>

        {/* 하단 안내 */}
        <p className="mt-10 text-center text-xl text-gray-700">
          좋은 시간 보내세요!
        </p>
      </div>
    </div>
  );
};

// ─── 장소 카드 (단순화 뷰 전용) ──────────────────────────────────────────────
const SimplePlaceCard = ({ item }: { item: ItineraryItem }) => {
  const { place } = item;

  if (!place) {
    return (
      <li className="simple-card rounded-2xl border-2 border-gray-400 bg-white p-6 text-2xl text-gray-700">
        정보를 불러올 수 없습니다.
      </li>
    );
  }

  // 길찾기 URL — 네이버 지도 기본
  const directionsUrl = place.location
    ? `https://map.naver.com/p/directions/-/-/-/${place.location.lng},${place.location.lat},${encodeURIComponent(
        place.name,
      )}`
    : `https://map.naver.com/p/search/${encodeURIComponent(place.name)}`;

  return (
    <li className="simple-card rounded-2xl border-2 border-gray-900 bg-white p-6">
      {/* 순서 + 장소명 */}
      <div className="mb-4 flex items-start gap-4">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gray-900 text-3xl font-bold text-white">
          {item.sequence_order}
        </span>
        <h2 className="place-name text-4xl font-bold leading-tight text-gray-900">
          {place.name}
        </h2>
      </div>

      {/* 접근성 정보 — 아이콘 + 텍스트 */}
      <div className="mb-4 space-y-2">
        {place.wheelchair_accessible && (
          <p className="flex items-center gap-3 text-2xl text-gray-900">
            <Accessibility className="h-8 w-8 text-blue-700" aria-hidden />
            <span>휠체어 이용 가능</span>
          </p>
        )}
        {place.stroller_accessible && (
          <p className="flex items-center gap-3 text-2xl text-gray-900">
            <Baby className="h-8 w-8 text-pink-700" aria-hidden />
            <span>유모차 이용 가능</span>
          </p>
        )}
      </div>

      {/* 주소 */}
      {place.address && (
        <p className="mb-3 flex items-start gap-3 text-2xl text-gray-900">
          <MapPin
            className="mt-1 h-7 w-7 shrink-0 text-gray-700"
            aria-hidden
          />
          <span>{place.address}</span>
        </p>
      )}

      {/* 머무는 시간 */}
      <p className="mb-5 text-2xl text-gray-900">
        머무는 시간: <strong>약 {item.stay_duration_minutes}분</strong>
      </p>

      {/* 대형 액션 버튼 */}
      <div className="no-print grid grid-cols-1 gap-3 sm:grid-cols-2">
        {place.phone && (
          <a
            href={`tel:${place.phone}`}
            className="inline-flex items-center justify-center gap-3 rounded-xl bg-blue-700 px-4 py-5 text-2xl font-bold text-white hover:bg-blue-800"
          >
            <Phone className="h-7 w-7" aria-hidden />
            전화 걸기
          </a>
        )}
        <a
          href={directionsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-3 rounded-xl bg-gray-900 px-4 py-5 text-2xl font-bold text-white hover:bg-gray-700"
        >
          <Navigation className="h-7 w-7" aria-hidden />
          길찾기
        </a>
      </div>
    </li>
  );
};

// ─── 유틸 ───────────────────────────────────────────────────────────────────
function formatDateKR(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]})`;
}

export default SimpleView;
