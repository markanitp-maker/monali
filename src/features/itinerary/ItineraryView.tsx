import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2, Play, Share2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type {
  CourseOption,
  ItineraryItem,
  Place,
  Trip,
} from "@/types/course";
import type { Companion } from "@/types/profile";
import { shouldUseSimpleView } from "@/types/profile";
import { ItineraryCard } from "./ItineraryCard";
import { PrintButton } from "./PrintButton";
import { SimpleView } from "./SimpleView";
import { ViewToggle, type ItineraryViewMode } from "./ViewToggle";
import "./print.css";

interface RawItineraryItem extends Omit<ItineraryItem, "place"> {
  place: Place | null;
}

interface RawCourse extends Omit<CourseOption, "items"> {
  items: RawItineraryItem[];
}

/**
 * 일정표 메인 뷰.
 *
 * - URL `/itinerary/:planId` → Trip + 선택된 course_option + items + places 로드
 * - digital_literacy === "LOW" 구성원이 그룹에 있으면 SimpleView 자동 진입
 * - 사용자가 토글로 모드 전환 가능
 * - 출발 버튼: trips.started_at 업데이트
 * - 공유 링크 생성: share-coordinator Edge Function 호출
 */
export const ItineraryView = () => {
  const { planId } = useParams<{ planId: string }>();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [course, setCourse] = useState<CourseOption | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ItineraryViewMode>("normal");
  const [autoSimpleResolved, setAutoSimpleResolved] = useState(false);
  const [starting, setStarting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  // ─── 데이터 로드 ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!planId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);

      // Promise.allSettled — 일부 실패해도 가능한 한 렌더
      const [tripRes, courseRes] = await Promise.allSettled([
        supabase.from("trips").select("*").eq("plan_id", planId).single(),
        supabase
          .from("course_options")
          .select(
            `
              course_id,
              plan_id,
              course_name,
              total_estimated_minutes,
              ai_reasoning,
              ai_model_used,
              is_selected,
              items:itinerary_items (
                item_id,
                course_id,
                place_id,
                sequence_order,
                stay_duration_minutes,
                transport_mode,
                transport_duration_minutes,
                notes,
                place:places (
                  place_id,
                  external_id,
                  name,
                  category,
                  address,
                  location,
                  wheelchair_accessible,
                  stroller_accessible,
                  dietary_options,
                  operating_hours,
                  phone,
                  accessibility_score,
                  last_verified_at
                )
              )
            `,
          )
          .eq("plan_id", planId)
          .eq("is_selected", true)
          .limit(1),
      ]);

      if (cancelled) return;

      if (tripRes.status === "fulfilled" && !tripRes.value.error) {
        setTrip(tripRes.value.data as Trip);
      } else if (tripRes.status === "fulfilled" && tripRes.value.error) {
        setError(`나들이 정보를 불러오지 못했습니다: ${tripRes.value.error.message}`);
      } else if (tripRes.status === "rejected") {
        setError("나들이 정보를 불러오지 못했습니다.");
      }

      if (courseRes.status === "fulfilled" && !courseRes.value.error) {
        const raw = (courseRes.value.data ?? []) as unknown as RawCourse[];
        if (raw.length === 0) {
          setCourse(null);
        } else {
          const c = raw[0];
          setCourse({
            ...c,
            items: c.items
              .filter(
                (i): i is RawItineraryItem & { place: Place } => i.place !== null,
              )
              .map((i) => ({
                item_id: i.item_id,
                course_id: i.course_id,
                place_id: i.place_id,
                place: i.place,
                sequence_order: i.sequence_order,
                stay_duration_minutes: i.stay_duration_minutes,
                transport_mode: i.transport_mode,
                transport_duration_minutes: i.transport_duration_minutes,
                notes: i.notes,
              })),
          });
        }
      }

      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [planId]);

  // ─── 그룹 구성원의 digital_level 기반 단순화 뷰 자동 선택 ──────────────────
  useEffect(() => {
    if (!trip?.group_id || autoSimpleResolved) return;
    let cancelled = false;

    (async () => {
      const { data, error: err } = await supabase
        .from("group_members")
        .select("companion:companions(digital_level)")
        .eq("group_id", trip.group_id);

      if (cancelled) return;
      setAutoSimpleResolved(true);
      if (err || !data) return;

      const companions = (data as unknown as { companion: Companion | null }[])
        .map((r) => r.companion)
        .filter((c): c is Companion => c !== null);

      if (shouldUseSimpleView(companions)) {
        setMode("simple");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [trip?.group_id, autoSimpleResolved]);

  // ─── 출발 버튼 ────────────────────────────────────────────────────────────
  const handleStart = useCallback(async () => {
    if (!trip || starting) return;
    setStarting(true);
    const startedAt = new Date().toISOString();
    const { error: err } = await supabase
      .from("trips")
      .update({ started_at: startedAt, status: "STARTED" })
      .eq("plan_id", trip.plan_id);

    if (!err) {
      setTrip({ ...trip, started_at: startedAt, status: "STARTED" });
    } else {
      setError(`출발 처리에 실패했습니다: ${err.message}`);
    }
    setStarting(false);
  }, [trip, starting]);

  // ─── 공유 링크 생성 ──────────────────────────────────────────────────────
  const handleShare = useCallback(async () => {
    if (!trip || sharing) return;
    setSharing(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/share/api/trips/${trip.plan_id}/share`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(session?.access_token
              ? { Authorization: `Bearer ${session.access_token}` }
              : {}),
          },
          body: JSON.stringify({ consensusDeadlineHours: 24 }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { shareUrl: string };
      setShareUrl(body.shareUrl);
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(body.shareUrl);
      }
    } catch (e) {
      setError(
        `공유 링크를 만들지 못했습니다: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setSharing(false);
    }
  }, [trip, sharing]);

  // ─── 도착 시각 계산 (시작 시각 또는 09:00 기준) ──────────────────────────
  const itemsWithTime = useMemo(() => {
    if (!course) return [];
    const sorted = course.items
      .slice()
      .sort((a, b) => a.sequence_order - b.sequence_order);
    const startBase = trip?.started_at
      ? new Date(trip.started_at)
      : new Date(`${trip?.scheduled_date ?? "2026-01-01"}T09:00:00`);

    let cursor = startBase.getTime();
    return sorted.map((item, idx) => {
      if (idx > 0) {
        cursor += (item.transport_duration_minutes ?? 0) * 60_000;
      }
      const arrival = new Date(cursor);
      const arrivalStr = `${String(arrival.getHours()).padStart(2, "0")}:${String(
        arrival.getMinutes(),
      ).padStart(2, "0")}`;
      cursor += item.stay_duration_minutes * 60_000;
      return { item, arrivalStr };
    });
  }, [course, trip?.started_at, trip?.scheduled_date]);

  // ─── 로딩 / 에러 / 빈 상태 ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-gray-600">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        일정표를 불러오는 중...
      </div>
    );
  }

  if (!trip) {
    return (
      <div className="mx-auto max-w-xl px-4 py-10 text-center">
        <p className="text-base text-red-600">
          {error ?? "나들이 정보를 찾을 수 없습니다."}
        </p>
      </div>
    );
  }

  if (!course) {
    return (
      <div className="mx-auto max-w-xl px-4 py-10 text-center">
        <p className="text-base text-gray-600">
          확정된 코스가 없습니다. 코스 비교 화면에서 먼저 코스를 확정해 주세요.
        </p>
      </div>
    );
  }

  // ─── 단순화 뷰 ────────────────────────────────────────────────────────────
  if (mode === "simple") {
    return (
      <SimpleView
        trip={trip}
        course={course}
        onSwitchMode={setMode}
        onStart={trip.started_at ? undefined : handleStart}
        starting={starting}
      />
    );
  }

  // ─── 일반 뷰 ──────────────────────────────────────────────────────────────
  return (
    <div className="itinerary-root min-h-screen bg-gray-50">
      <div className="mx-auto max-w-2xl px-4 py-6">
        {/* 상단 컨트롤 바 */}
        <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3">
          <ViewToggle mode={mode} onChange={setMode} />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleShare}
              disabled={sharing}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <Share2 className="h-4 w-4" aria-hidden />
              {sharing ? "생성 중..." : "공유 링크"}
            </button>
            <PrintButton
              planId={trip.plan_id}
              scheduledDate={trip.scheduled_date}
            />
          </div>
        </div>

        {shareUrl && (
          <div className="no-print mb-4 rounded-md border border-green-200 bg-green-50 p-3 text-xs text-green-800">
            공유 링크가 복사되었습니다:{" "}
            <a
              href={shareUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              {shareUrl}
            </a>
          </div>
        )}

        {error && (
          <div className="no-print mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            {error}
          </div>
        )}

        {/* 헤더 */}
        <header className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h1 className="text-xl font-bold text-gray-900">{trip.title}</h1>
          <div className="mt-1 flex flex-wrap gap-3 text-sm text-gray-600">
            {trip.scheduled_date && <span>{trip.scheduled_date}</span>}
            <span>장소 {course.items.length}곳</span>
            {course.total_estimated_minutes && (
              <span>
                총 {Math.floor(course.total_estimated_minutes / 60)}시간{" "}
                {course.total_estimated_minutes % 60}분
              </span>
            )}
          </div>
          {course.ai_reasoning && (
            <p className="mt-3 text-xs text-gray-500">{course.ai_reasoning}</p>
          )}
        </header>

        {/* 출발 버튼 */}
        {!trip.started_at && (
          <button
            type="button"
            onClick={handleStart}
            disabled={starting}
            className="no-print mb-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 px-4 py-3 text-base font-semibold text-white shadow-sm hover:bg-green-700 disabled:bg-gray-400"
          >
            <Play className="h-5 w-5" aria-hidden />
            {starting ? "출발 처리 중..." : "지금 출발하기"}
          </button>
        )}
        {trip.started_at && (
          <p className="mb-6 rounded-xl bg-green-50 px-3 py-2 text-center text-sm font-medium text-green-800">
            출발 시각:{" "}
            {new Date(trip.started_at).toLocaleString("ko-KR", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        )}

        {/* 장소 목록 */}
        <ol className="space-y-3">
          {itemsWithTime.map(({ item, arrivalStr }, idx) => (
            <ItineraryCard
              key={item.item_id}
              item={item}
              isFirst={idx === 0}
              arrivalTime={arrivalStr}
            />
          ))}
        </ol>
      </div>
    </div>
  );
};

export default ItineraryView;
