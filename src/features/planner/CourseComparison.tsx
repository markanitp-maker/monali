import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2, Share2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { CourseOption, ItineraryItem, Place } from "@/types/course";
import { CourseCard } from "./CourseCard";

interface RawItineraryItem extends Omit<ItineraryItem, "place"> {
  place: Place | null;
}

interface RawCourse extends Omit<CourseOption, "items"> {
  items: RawItineraryItem[];
}

/**
 * 코스 비교 페이지
 * - 라우트 파라미터 planId 기준으로 course_options + itinerary_items + places 조회
 * - 2~3개 카드 나란히 표시
 * - "이 코스로 확정" 버튼 (course_options.is_selected UPDATE)
 * - 공유 링크 생성 버튼 (share-coordinator 가 이어서 구현)
 */
export const CourseComparison = () => {
  const { planId } = useParams<{ planId: string }>();
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    if (!planId) return;
    void load(planId);
  }, [planId]);

  const load = async (pid: string) => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
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
      .eq("plan_id", pid)
      .order("created_at", { ascending: true });

    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }

    const raw = (data ?? []) as unknown as RawCourse[];
    const normalized: CourseOption[] = raw.map((c) => ({
      ...c,
      items: c.items
        .filter((i): i is RawItineraryItem & { place: Place } => i.place !== null)
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
    }));

    setCourses(normalized);
    setLoading(false);
  };

  const onSelectCourse = async (courseId: string) => {
    if (!planId) return;
    // 트랜잭션 효과: 같은 plan_id 의 모든 course → is_selected=false, 해당만 true
    const { error: e1 } = await supabase
      .from("course_options")
      .update({ is_selected: false })
      .eq("plan_id", planId);
    if (e1) {
      setError(e1.message);
      return;
    }
    const { error: e2 } = await supabase
      .from("course_options")
      .update({ is_selected: true })
      .eq("course_id", courseId);
    if (e2) {
      setError(e2.message);
      return;
    }
    // trips.status = AGREED 로 갱신
    await supabase
      .from("trips")
      .update({ status: "AGREED" })
      .eq("plan_id", planId);

    setCourses((cs) =>
      cs.map((c) => ({ ...c, is_selected: c.course_id === courseId })),
    );
  };

  const onShare = async () => {
    // share-coordinator D3 에서 구현 예정. 여기서는 자리만 마련.
    if (!planId) return;
    setSharing(true);
    try {
      const { data, error: err } = await supabase.functions.invoke<{
        share_url: string;
      }>("share/create", {
        method: "POST",
        body: { plan_id: planId },
      });
      if (err) throw err;
      if (data?.share_url) {
        await navigator.clipboard.writeText(data.share_url);
        alert("공유 링크가 클립보드에 복사되었습니다.");
      }
    } catch {
      alert("공유 기능은 곧 사용 가능합니다.");
    } finally {
      setSharing(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16 text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-600" />
        <p className="mt-3 text-sm text-gray-500">코스를 불러오는 중...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          코스를 불러오지 못했습니다: {error}
        </div>
      </div>
    );
  }

  if (courses.length === 0) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16 text-center text-sm text-gray-500">
        아직 생성된 코스가 없습니다.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">코스 비교</h1>
          <p className="mt-1 text-sm text-gray-500">
            {courses.length}개의 코스 중 하나를 선택하거나 가족과 공유해 투표를
            받아보세요.
          </p>
        </div>
        <button
          type="button"
          onClick={onShare}
          disabled={sharing}
          className="inline-flex items-center gap-2 rounded-lg border border-blue-600 px-4 py-2 text-sm font-semibold text-blue-600 hover:bg-blue-50 disabled:opacity-50"
        >
          <Share2 className="h-4 w-4" />
          {sharing ? "생성 중..." : "공유 링크"}
        </button>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {courses.map((c) => (
          <CourseCard
            key={c.course_id}
            course={c}
            showSelectButton
            onSelect={onSelectCourse}
          />
        ))}
      </div>
    </div>
  );
};

export default CourseComparison;
