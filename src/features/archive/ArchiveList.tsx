import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Calendar, Camera, MapPin, NotebookPen, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Trip } from "@/types/course";
import type { ArchiveListItem, OutingArchive } from "@/types/archive";
import { StarRating } from "./StarRating";

/**
 * 아카이브 목록
 * - completed_at 내림차순
 * - 완료된 나들이 (status=COMPLETED) 중 아카이브가 없는 것은 "기록 남기기" 버튼 노출
 * - 아카이브 카드 클릭 → 상세
 * - "다시 가기": 동일 그룹/장소 기반 새 플랜 (현재 단계에서는 /planner/new 로 단순 이동)
 */
export const ArchiveList = () => {
  const navigate = useNavigate();
  const [archives, setArchives] = useState<ArchiveListItem[]>([]);
  const [pendingTrips, setPendingTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);

      // 1) 사용자 trips
      const { data: trips, error: tripErr } = await supabase
        .from("trips")
        .select("*")
        .order("scheduled_date", { ascending: false, nullsFirst: false });
      if (tripErr) {
        setError(tripErr.message);
        setLoading(false);
        return;
      }
      const tripList = (trips ?? []) as Trip[];

      // 2) outing_archives
      const planIds = tripList.map((t) => t.plan_id);
      let archiveRows: OutingArchive[] = [];
      if (planIds.length > 0) {
        const { data: rows, error: arcErr } = await supabase
          .from("outing_archives")
          .select("*")
          .in("plan_id", planIds)
          .order("created_at", { ascending: false });
        if (arcErr) {
          setError(arcErr.message);
          setLoading(false);
          return;
        }
        archiveRows = (rows ?? []) as OutingArchive[];
      }

      // 3) 조인 enrich
      const tripMap = new Map(tripList.map((t) => [t.plan_id, t] as const));
      const enriched: ArchiveListItem[] = archiveRows.map((a) => {
        const trip = tripMap.get(a.plan_id);
        const photos = a.photo_urls ?? [];
        const fbs = a.accessibility_feedback ?? [];
        const uniquePlaces = new Set(fbs.map((f) => f.placeId));
        return {
          ...a,
          trip_title: trip?.title,
          scheduled_date: trip?.scheduled_date ?? null,
          place_count: uniquePlaces.size,
          thumbnail_url: photos[0] ?? null,
        };
      });

      // 4) 아카이브 없는 완료/시작 plan 추출
      const archivedSet = new Set(archiveRows.map((a) => a.plan_id));
      const pending = tripList.filter(
        (t) =>
          (t.status === "COMPLETED" || t.status === "STARTED") &&
          !archivedSet.has(t.plan_id),
      );

      setArchives(enriched);
      setPendingTrips(pending);
      setLoading(false);
    };

    void load();
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">나들이 아카이브</h1>
        <p className="mt-1 text-sm text-gray-500">
          다녀온 코스의 만족도와 실제 접근성 정보를 기록해
          다음 추천에 반영합니다.
        </p>
      </header>

      {loading && (
        <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
          불러오는 중...
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          아카이브를 불러오지 못했습니다: {error}
        </div>
      )}

      {!loading && !error && (
        <>
          {/* 기록 대기 중인 나들이 */}
          {pendingTrips.length > 0 && (
            <section className="mb-8">
              <h2 className="mb-3 text-lg font-semibold">
                기록을 기다리는 나들이
              </h2>
              <ul className="space-y-2">
                {pendingTrips.map((trip) => (
                  <li
                    key={trip.plan_id}
                    className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 p-4"
                  >
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-base font-semibold">
                        {trip.title}
                      </h3>
                      <p className="mt-1 text-xs text-gray-600">
                        {trip.scheduled_date ?? "날짜 미정"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        navigate(`/archive/${trip.plan_id}/feedback`)
                      }
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
                    >
                      <NotebookPen className="h-3.5 w-3.5" />
                      기록 남기기
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* 아카이브 목록 */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">지난 나들이</h2>

            {archives.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-10 text-center text-sm text-gray-500">
                아직 저장된 아카이브가 없습니다.
              </div>
            ) : (
              <ul className="space-y-3">
                {archives.map((a) => (
                  <li key={a.archive_id}>
                    <Link
                      to={`/archive/${a.archive_id}`}
                      className="flex gap-3 rounded-lg border border-gray-200 bg-white p-4 transition hover:border-blue-400 hover:shadow-sm"
                    >
                      {/* 썸네일 */}
                      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md bg-gray-100">
                        {a.thumbnail_url ? (
                          <img
                            src={a.thumbnail_url}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-gray-300">
                            <Camera className="h-6 w-6" />
                          </div>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-base font-semibold">
                          {a.trip_title ?? "제목 없음"}
                        </h3>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
                          {a.scheduled_date && (
                            <span className="inline-flex items-center gap-1">
                              <Calendar className="h-3.5 w-3.5" />
                              {a.scheduled_date}
                            </span>
                          )}
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5" />
                            장소 {a.place_count ?? 0}곳
                          </span>
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <StarRating
                            value={a.overall_score}
                            readOnly
                            size="sm"
                          />
                          <span className="text-xs text-gray-500">
                            {a.overall_score}/5
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          navigate("/planner/new");
                        }}
                        className="inline-flex shrink-0 items-center gap-1 self-start rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      >
                        <RefreshCw className="h-3 w-3" />
                        다시 가기
                      </button>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
};

export default ArchiveList;
