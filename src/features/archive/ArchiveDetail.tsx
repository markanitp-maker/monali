import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Calendar, CheckCircle2, XCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { AccessibilityFeedback, OutingArchive } from "@/types/archive";
import { StarRating } from "./StarRating";

interface ArchiveDetailData extends OutingArchive {
  trip_title?: string;
  scheduled_date?: string | null;
}

/**
 * 아카이브 상세 보기
 * - URL: /archive/:id
 */
export const ArchiveDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<ArchiveDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      setLoading(true);
      setError(null);

      const { data: archive, error: arcErr } = await supabase
        .from("outing_archives")
        .select("*")
        .eq("archive_id", id)
        .single();
      if (arcErr || !archive) {
        setError(arcErr?.message ?? "아카이브를 찾을 수 없습니다.");
        setLoading(false);
        return;
      }

      const { data: trip } = await supabase
        .from("trips")
        .select("title, scheduled_date")
        .eq("plan_id", archive.plan_id)
        .single();

      setData({
        ...(archive as OutingArchive),
        trip_title: trip?.title,
        scheduled_date: trip?.scheduled_date ?? null,
      });
      setLoading(false);
    };
    void load();
  }, [id]);

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8 text-center text-sm text-gray-500">
        불러오는 중...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error ?? "아카이브를 찾을 수 없습니다."}
        </div>
      </div>
    );
  }

  const feedbacks = (data.accessibility_feedback ??
    []) as AccessibilityFeedback[];
  const photos = data.photo_urls ?? [];

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <button
        type="button"
        onClick={() => navigate("/archive")}
        className="mb-4 inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
      >
        <ArrowLeft className="h-4 w-4" />
        아카이브 목록
      </button>

      <header className="mb-6">
        <h1 className="text-2xl font-bold">
          {data.trip_title ?? "제목 없음"}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-gray-500">
          {data.scheduled_date && (
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-4 w-4" />
              {data.scheduled_date}
            </span>
          )}
          <span>
            기록일: {new Date(data.created_at).toLocaleDateString()}
          </span>
        </div>
      </header>

      {/* 만족도 */}
      <section className="mb-6 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="mb-2 text-sm font-semibold">전체 만족도</h2>
        <div className="flex items-center gap-3">
          <StarRating
            value={data.overall_score}
            readOnly
            size="lg"
          />
          <span className="text-base font-semibold">
            {data.overall_score}/5
          </span>
        </div>
      </section>

      {/* 사진 */}
      {photos.length > 0 && (
        <section className="mb-6 rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold">사진</h2>
          <div className="grid grid-cols-3 gap-2">
            {photos.map((url, idx) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="block aspect-square overflow-hidden rounded-md border border-gray-200"
              >
                <img
                  src={url}
                  alt={`사진 ${idx + 1}`}
                  className="h-full w-full object-cover"
                />
              </a>
            ))}
          </div>
        </section>
      )}

      {/* 장소별 접근성 */}
      <section className="mb-6 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold">장소별 접근성 피드백</h2>
        {feedbacks.length === 0 ? (
          <p className="text-sm text-gray-500">기록된 피드백이 없습니다.</p>
        ) : (
          <ul className="space-y-3">
            {feedbacks.map((fb) => (
              <li
                key={fb.placeId}
                className="flex gap-3 rounded-md border border-gray-100 bg-gray-50 p-3"
              >
                <div className="shrink-0">
                  {fb.actualAccessible ? (
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                  ) : (
                    <XCircle className="h-5 w-5 text-red-500" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{fb.placeName}</div>
                  <div
                    className={`text-xs ${
                      fb.actualAccessible
                        ? "text-green-700"
                        : "text-red-700"
                    }`}
                  >
                    {fb.actualAccessible
                      ? "접근 가능했어요"
                      : "접근이 불편했어요"}
                  </div>
                  {fb.notes && (
                    <p className="mt-1 whitespace-pre-line text-xs text-gray-600">
                      {fb.notes}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 메모 */}
      {data.memo && (
        <section className="mb-6 rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="mb-2 text-sm font-semibold">메모</h2>
          <p className="whitespace-pre-line text-sm text-gray-700">
            {data.memo}
          </p>
        </section>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => navigate(`/archive/${data.plan_id}/feedback`)}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          기록 수정
        </button>
      </div>
    </div>
  );
};

export default ArchiveDetail;
