import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ImagePlus, Loader2, Save, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { ItineraryItem } from "@/types/course";
import type {
  AccessibilityFeedback,
  ArchiveUpsertRequest,
} from "@/types/archive";
import { StarRating } from "./StarRating";

interface PlaceForFeedback {
  placeId: string;
  placeName: string;
}

/**
 * 아카이브 입력 폼
 * - URL: /archive/:planId/feedback
 * - 만족도 별점 (1-5)
 * - 방문 장소별 접근성 체크 + 메모
 * - 사진 첨부 (선택, 최대 5장)
 * - 저장 완료 → /archive 리다이렉트
 */
export const ArchiveForm = () => {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();

  const [places, setPlaces] = useState<PlaceForFeedback[]>([]);
  const [overallRating, setOverallRating] = useState<number>(5);
  const [feedbackMap, setFeedbackMap] = useState<
    Record<string, { actualAccessible: boolean; notes: string }>
  >({});
  const [memo, setMemo] = useState("");
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // 기존 아카이브 + 선택된 코스의 장소들 로드
  useEffect(() => {
    if (!planId) return;
    const load = async () => {
      setLoading(true);
      setLoadError(null);

      // 1) 선택된 코스
      const { data: courses, error: courseErr } = await supabase
        .from("course_options")
        .select("course_id, is_selected")
        .eq("plan_id", planId);
      if (courseErr) {
        setLoadError(courseErr.message);
        setLoading(false);
        return;
      }
      const selected =
        courses?.find((c) => c.is_selected) ?? courses?.[0];
      if (!selected) {
        setLoadError("코스를 찾을 수 없습니다.");
        setLoading(false);
        return;
      }

      // 2) 코스 아이템 + 장소
      const { data: items, error: itemErr } = await supabase
        .from("itinerary_items")
        .select("item_id, sequence_order, places(place_id, name)")
        .eq("course_id", selected.course_id)
        .order("sequence_order", { ascending: true });
      if (itemErr) {
        setLoadError(itemErr.message);
        setLoading(false);
        return;
      }

      type ItemRow = Pick<ItineraryItem, "item_id" | "sequence_order"> & {
        places: { place_id: string; name: string } | null;
      };
      const placeList: PlaceForFeedback[] = (items as unknown as ItemRow[])
        .filter((it) => it.places != null)
        .map((it) => ({
          placeId: it.places!.place_id,
          placeName: it.places!.name,
        }));
      setPlaces(placeList);

      // 3) 기존 아카이브 (있으면 prefill)
      const { data: existing } = await supabase
        .from("outing_archives")
        .select("*")
        .eq("outing_plan_id", planId)
        .maybeSingle();

      const initialMap: Record<
        string,
        { actualAccessible: boolean; notes: string }
      > = {};
      const existingFbs = (existing?.accessibility_feedback ??
        []) as AccessibilityFeedback[];
      for (const p of placeList) {
        const found = existingFbs.find((f) => f.placeId === p.placeId);
        initialMap[p.placeId] = {
          actualAccessible: found?.actualAccessible ?? true,
          notes: found?.notes ?? "",
        };
      }
      setFeedbackMap(initialMap);

      if (existing) {
        setOverallRating(existing.satisfaction_score ?? 5);
        setMemo(existing.memo ?? "");
        setPhotoUrls((existing.photo_urls ?? []) as string[]);
      }

      setLoading(false);
    };
    void load();
  }, [planId]);

  const handlePhotoSelect = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    if (photoUrls.length + files.length > 5) {
      setSaveError("사진은 최대 5장까지 첨부할 수 있습니다.");
      return;
    }

    setUploading(true);
    const newUrls: string[] = [];

    // Promise.allSettled — 일부 실패해도 성공한 것은 반영
    const uploadTasks = files.map(async (file) => {
      const ts = Date.now();
      const rand = Math.random().toString(36).slice(2, 8);
      const path = `archive/${planId}/${ts}-${rand}.jpg`;
      const { error } = await supabase.storage
        .from("archive-photos")
        .upload(path, file, { cacheControl: "3600", upsert: false });
      if (error) throw error;
      const { data } = supabase.storage
        .from("archive-photos")
        .getPublicUrl(path);
      return data.publicUrl;
    });

    const results = await Promise.allSettled(uploadTasks);
    for (const r of results) {
      if (r.status === "fulfilled") newUrls.push(r.value);
      else console.error("[archive] photo upload failed:", r.reason);
    }

    if (newUrls.length === 0) {
      setSaveError(
        "사진 업로드에 실패했습니다. 텍스트 피드백만 저장할 수 있습니다.",
      );
    }
    setPhotoUrls((prev) => [...prev, ...newUrls]);
    setUploading(false);
    e.target.value = "";
  };

  const removePhoto = (url: string) => {
    setPhotoUrls((prev) => prev.filter((u) => u !== url));
  };

  const handleSubmit = async () => {
    if (!planId) return;
    setSubmitting(true);
    setSaveError(null);

    const feedback: AccessibilityFeedback[] = places.map((p) => ({
      placeId: p.placeId,
      placeName: p.placeName,
      actualAccessible: feedbackMap[p.placeId]?.actualAccessible ?? true,
      notes: feedbackMap[p.placeId]?.notes || undefined,
    }));

    const body: ArchiveUpsertRequest = {
      planId,
      overallRating: overallRating as 1 | 2 | 3 | 4 | 5,
      accessibilityFeedback: feedback,
      memo: memo || undefined,
      photoUrls: photoUrls.length > 0 ? photoUrls : undefined,
    };

    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;

    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/archive`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token ?? ""}`,
      },
      body: JSON.stringify(body),
    });

    setSubmitting(false);

    if (!res.ok) {
      const errBody = await res.json().catch(() => null);
      setSaveError(
        errBody?.error?.message ?? `저장 실패 (HTTP ${res.status})`,
      );
      return;
    }
    navigate("/archive");
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8 text-center text-sm text-gray-500">
        불러오는 중...
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {loadError}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">나들이 기록 남기기</h1>
        <p className="mt-1 text-sm text-gray-500">
          실제 다녀온 경험을 남겨주시면 다음 추천이 더 정확해져요.
        </p>
      </header>

      {/* 만족도 */}
      <section className="mb-6 rounded-lg border border-gray-200 bg-white p-5">
        <label className="mb-3 block text-sm font-semibold">
          전체 만족도
        </label>
        <div className="flex items-center gap-3">
          <StarRating
            value={overallRating}
            onChange={setOverallRating}
            size="lg"
          />
          <span className="text-sm text-gray-500">{overallRating}/5</span>
        </div>
      </section>

      {/* 장소별 접근성 */}
      <section className="mb-6 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold">
          방문한 장소, 실제로 어땠나요?
        </h2>
        {places.length === 0 ? (
          <p className="text-sm text-gray-500">방문 장소가 없습니다.</p>
        ) : (
          <ul className="space-y-4">
            {places.map((p) => {
              const fb = feedbackMap[p.placeId] ?? {
                actualAccessible: true,
                notes: "",
              };
              return (
                <li
                  key={p.placeId}
                  className="rounded-md border border-gray-100 bg-gray-50 p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium">{p.placeName}</span>
                    <div className="flex shrink-0 gap-2">
                      <label className="inline-flex items-center gap-1 text-xs">
                        <input
                          type="radio"
                          name={`access-${p.placeId}`}
                          checked={fb.actualAccessible}
                          onChange={() =>
                            setFeedbackMap((prev) => ({
                              ...prev,
                              [p.placeId]: { ...fb, actualAccessible: true },
                            }))
                          }
                        />
                        가능했어요
                      </label>
                      <label className="inline-flex items-center gap-1 text-xs">
                        <input
                          type="radio"
                          name={`access-${p.placeId}`}
                          checked={!fb.actualAccessible}
                          onChange={() =>
                            setFeedbackMap((prev) => ({
                              ...prev,
                              [p.placeId]: { ...fb, actualAccessible: false },
                            }))
                          }
                        />
                        불편했어요
                      </label>
                    </div>
                  </div>
                  <textarea
                    placeholder="구체적인 메모 (선택)"
                    value={fb.notes}
                    onChange={(e) =>
                      setFeedbackMap((prev) => ({
                        ...prev,
                        [p.placeId]: { ...fb, notes: e.target.value },
                      }))
                    }
                    rows={2}
                    maxLength={500}
                    className="mt-2 w-full rounded border border-gray-200 px-2 py-1 text-xs"
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 사진 */}
      <section className="mb-6 rounded-lg border border-gray-200 bg-white p-5">
        <label className="mb-3 block text-sm font-semibold">
          사진 (선택, 최대 5장)
        </label>
        <div className="flex flex-wrap gap-2">
          {photoUrls.map((url) => (
            <div
              key={url}
              className="relative h-20 w-20 overflow-hidden rounded-md border border-gray-200"
            >
              <img
                src={url}
                alt="첨부 사진"
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                onClick={() => removePhoto(url)}
                className="absolute right-0 top-0 rounded-bl-md bg-black/50 p-1 text-white"
                aria-label="사진 제거"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
          {photoUrls.length < 5 && (
            <label className="flex h-20 w-20 cursor-pointer items-center justify-center rounded-md border border-dashed border-gray-300 text-gray-400 hover:border-blue-400 hover:text-blue-500">
              {uploading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <ImagePlus className="h-5 w-5" />
              )}
              <input
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={handlePhotoSelect}
                disabled={uploading}
              />
            </label>
          )}
        </div>
      </section>

      {/* 메모 */}
      <section className="mb-6 rounded-lg border border-gray-200 bg-white p-5">
        <label className="mb-2 block text-sm font-semibold" htmlFor="memo">
          전체 메모 (선택)
        </label>
        <textarea
          id="memo"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          rows={4}
          maxLength={2000}
          placeholder="이번 나들이 전체에 대한 감상을 자유롭게 남겨주세요."
          className="w-full rounded border border-gray-200 px-3 py-2 text-sm"
        />
      </section>

      {saveError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {saveError}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => navigate("/archive")}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          취소
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          기록 저장
        </button>
      </div>
    </div>
  );
};

export default ArchiveForm;
