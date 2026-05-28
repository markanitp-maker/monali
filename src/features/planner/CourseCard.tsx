import { Accessibility, Baby, Car, Clock, Footprints, Bus } from "lucide-react";
import type { CourseOption, ItineraryItem, TransportMode } from "@/types/course";

interface CourseCardProps {
  course: CourseOption;
  /** 코스 확정 버튼 표시 여부 */
  showSelectButton?: boolean;
  onSelect?: (courseId: string) => void;
  selected?: boolean;
}

const TRANSPORT_LABEL: Record<TransportMode, string> = {
  walk: "도보",
  car: "차량",
  public: "대중교통",
};

const TransportIcon = ({ mode }: { mode: TransportMode }) => {
  if (mode === "walk") return <Footprints className="h-3.5 w-3.5" />;
  if (mode === "public") return <Bus className="h-3.5 w-3.5" />;
  return <Car className="h-3.5 w-3.5" />;
};

/** CourseOption 1개를 카드 형태로 표시 */
export const CourseCard = ({
  course,
  showSelectButton = false,
  onSelect,
  selected = false,
}: CourseCardProps) => {
  const totalMin = course.total_estimated_minutes ?? 0;
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;

  return (
    <article
      className={`flex h-full flex-col rounded-xl border bg-white p-5 shadow-sm transition ${
        selected || course.is_selected
          ? "border-blue-500 ring-2 ring-blue-200"
          : "border-gray-200 hover:border-blue-300"
      }`}
    >
      <header className="mb-3 flex items-start justify-between gap-2">
        <h3 className="text-base font-semibold leading-tight">{course.course_name}</h3>
        {course.is_selected && (
          <span className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
            확정
          </span>
        )}
      </header>

      {totalMin > 0 && (
        <p className="mb-3 inline-flex items-center gap-1 text-xs text-gray-500">
          <Clock className="h-3.5 w-3.5" />총 {hours > 0 ? `${hours}시간` : ""}
          {minutes > 0 ? ` ${minutes}분` : ""}
        </p>
      )}

      {course.ai_reasoning && (
        <p className="mb-4 line-clamp-3 text-xs text-gray-600">
          {course.ai_reasoning}
        </p>
      )}

      {/* 장소 목록 */}
      <ol className="mb-4 flex-1 space-y-3">
        {course.items
          .slice()
          .sort((a, b) => a.sequence_order - b.sequence_order)
          .map((item, idx, arr) => (
            <PlaceRow
              key={item.item_id}
              item={item}
              isFirst={idx === 0}
              isLast={idx === arr.length - 1}
            />
          ))}
      </ol>

      {/* 투표 집계 (있을 때) */}
      {course.vote_summary && (
        <div className="mb-3 flex gap-3 text-xs">
          <span className="text-green-700">
            👍 {course.vote_summary.positive}
          </span>
          <span className="text-red-700">
            👎 {course.vote_summary.negative}
          </span>
        </div>
      )}

      {showSelectButton && onSelect && (
        <button
          type="button"
          onClick={() => onSelect(course.course_id)}
          disabled={course.is_selected}
          className="mt-auto w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-gray-300"
        >
          {course.is_selected ? "확정됨" : "이 코스로 확정"}
        </button>
      )}
    </article>
  );
};

const PlaceRow = ({
  item,
  isFirst,
}: {
  item: ItineraryItem;
  isFirst: boolean;
  isLast: boolean;
}) => {
  const { place } = item;
  return (
    <li className="relative">
      {/* 이전 장소 → 현재 장소로의 이동 정보 (첫 장소 제외) */}
      {!isFirst && (
        <div className="mb-2 ml-2 flex items-center gap-1 text-xs text-gray-500">
          <TransportIcon mode={item.transport_mode} />
          <span>
            {TRANSPORT_LABEL[item.transport_mode]}
            {item.transport_duration_minutes
              ? ` · ${item.transport_duration_minutes}분`
              : ""}
          </span>
        </div>
      )}

      <div className="flex gap-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">
          {item.sequence_order}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-medium">{place.name}</p>
            {place.wheelchair_accessible && (
              <Accessibility
                className="h-3.5 w-3.5 text-blue-600"
                aria-label="휠체어 접근 가능"
              />
            )}
            {place.stroller_accessible && (
              <Baby
                className="h-3.5 w-3.5 text-pink-600"
                aria-label="유모차 접근 가능"
              />
            )}
          </div>
          {place.address && (
            <p className="truncate text-xs text-gray-500">{place.address}</p>
          )}
          <p className="mt-0.5 text-xs text-gray-500">
            <Clock className="mr-0.5 inline h-3 w-3" />
            체류 {item.stay_duration_minutes}분
          </p>
        </div>
      </div>
    </li>
  );
};

export default CourseCard;
