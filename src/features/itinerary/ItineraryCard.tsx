import {
  Accessibility,
  Baby,
  Bus,
  Car,
  Clock,
  Footprints,
  MapPin,
  Phone,
} from "lucide-react";
import type { ItineraryItem, TransportMode } from "@/types/course";

interface ItineraryCardProps {
  item: ItineraryItem;
  /** 첫 번째 장소면 이동 정보 헤더 숨김 */
  isFirst?: boolean;
  /** 시작 시각 (HH:MM) — 부모에서 시간 계산해 전달 (옵션) */
  arrivalTime?: string;
}

const TRANSPORT_LABEL: Record<TransportMode, string> = {
  walk: "도보",
  car: "차량",
  public: "대중교통",
};

const TransportIcon = ({ mode }: { mode: TransportMode }) => {
  if (mode === "walk") return <Footprints className="h-4 w-4" aria-hidden />;
  if (mode === "public") return <Bus className="h-4 w-4" aria-hidden />;
  return <Car className="h-4 w-4" aria-hidden />;
};

/** 일정표 일반 뷰 — 장소 카드 1개 */
export const ItineraryCard = ({
  item,
  isFirst = false,
  arrivalTime,
}: ItineraryCardProps) => {
  const { place } = item;

  if (!place) {
    return (
      <li className="itinerary-card rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">
        정보를 불러올 수 없습니다.
      </li>
    );
  }

  return (
    <li className="itinerary-card relative">
      {/* 이동 정보 */}
      {!isFirst && (
        <div className="mb-2 ml-3 flex items-center gap-1.5 text-xs text-gray-500">
          <TransportIcon mode={item.transport_mode} />
          <span>
            {TRANSPORT_LABEL[item.transport_mode]}
            {item.transport_duration_minutes
              ? ` · ${item.transport_duration_minutes}분`
              : ""}
          </span>
        </div>
      )}

      <article className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <header className="mb-2 flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-700">
              {item.sequence_order}
            </span>
            <h3 className="text-base font-semibold text-gray-900">
              {place.name}
            </h3>
          </div>
          {arrivalTime && (
            <time className="shrink-0 rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
              {arrivalTime}
            </time>
          )}
        </header>

        {/* 접근성 배지 */}
        <div className="mb-2 flex flex-wrap gap-1.5">
          {place.wheelchair_accessible && (
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
              <Accessibility className="h-3 w-3" aria-hidden />
              휠체어 가능
            </span>
          )}
          {place.stroller_accessible && (
            <span className="inline-flex items-center gap-1 rounded-full bg-pink-50 px-2 py-0.5 text-xs text-pink-700">
              <Baby className="h-3 w-3" aria-hidden />
              유모차 가능
            </span>
          )}
        </div>

        {place.address && (
          <p className="mb-1 flex items-start gap-1.5 text-sm text-gray-600">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{place.address}</span>
          </p>
        )}

        {place.phone && (
          <p className="mb-1 flex items-center gap-1.5 text-sm text-gray-600">
            <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <a
              href={`tel:${place.phone}`}
              className="text-blue-600 underline-offset-2 hover:underline"
            >
              {place.phone}
            </a>
          </p>
        )}

        <p className="mt-2 inline-flex items-center gap-1 text-xs text-gray-500">
          <Clock className="h-3 w-3" aria-hidden />
          체류 약 {item.stay_duration_minutes}분
        </p>

        {item.notes && (
          <p className="mt-2 rounded-md bg-yellow-50 px-2 py-1 text-xs text-yellow-800">
            {item.notes}
          </p>
        )}
      </article>
    </li>
  );
};

export default ItineraryCard;
