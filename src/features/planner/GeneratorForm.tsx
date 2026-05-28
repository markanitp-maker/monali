import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, MapPin } from "lucide-react";
import { useProfiles } from "@/features/profile/useProfiles";
import { usePlannerGenerate } from "./usePlannerGenerate";
import {
  MOOD_TAG_PRESETS,
  type GeneratePlanRequest,
} from "@/types/course";

interface FormState {
  address: string;
  lat: string;
  lng: string;
  radius_km: number;
  scheduled_date: string;
  duration_days: number;
  group_id: string;
  mood_tags: string[];
  additional_notes: string;
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * 코스 생성 요청 폼
 * - 제출 시 POST /api/planner/generate → 202 응답 수신
 * - 응답 받으면 /planner/progress/:taskId 로 이동
 */
export const GeneratorForm = () => {
  const navigate = useNavigate();
  const { groups, loading: profilesLoading } = useProfiles();
  const { generate, submitting, lastError, creditError } = usePlannerGenerate();

  const [form, setForm] = useState<FormState>({
    address: "",
    lat: "",
    lng: "",
    radius_km: 20,
    scheduled_date: today(),
    duration_days: 1,
    group_id: "",
    mood_tags: [],
    additional_notes: "",
  });

  const creditsRequired = useMemo(
    () => form.duration_days * 30,
    [form.duration_days],
  );

  const toggleMoodTag = (tag: string) =>
    setForm((s) => ({
      ...s,
      mood_tags: s.mood_tags.includes(tag)
        ? s.mood_tags.filter((t) => t !== tag)
        : [...s.mood_tags, tag],
    }));

  const valid =
    form.address.trim().length > 0 &&
    Number.isFinite(parseFloat(form.lat)) &&
    Number.isFinite(parseFloat(form.lng)) &&
    form.group_id.length > 0 &&
    form.scheduled_date.length === 10;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || submitting) return;

    const req: GeneratePlanRequest = {
      origin: {
        address: form.address.trim(),
        lat: parseFloat(form.lat),
        lng: parseFloat(form.lng),
      },
      radius_km: form.radius_km,
      scheduled_date: form.scheduled_date,
      duration_days: form.duration_days,
      group_id: form.group_id,
      mood_tags: form.mood_tags,
      additional_notes: form.additional_notes.trim() || undefined,
    };

    try {
      const res = await generate(req);
      navigate(`/planner/progress/${res.task_id}`, {
        state: { planId: res.plan_id },
      });
    } catch {
      /* 에러는 lastError 로 표시 */
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-2 text-2xl font-bold">새 코스 만들기</h1>
      <p className="mb-6 text-sm text-gray-500">
        AI가 가족 제약을 반영해 최적의 무장애 코스 2~3개를 제안합니다.
        <br />
        예상 소비 크레딧:{" "}
        <span className="font-semibold text-blue-600">{creditsRequired}</span>
      </p>

      <form onSubmit={onSubmit} className="space-y-5">
        {/* 출발지 */}
        <fieldset className="space-y-2 rounded-lg border border-gray-200 bg-white p-4">
          <legend className="px-1 text-sm font-semibold">
            <MapPin className="mr-1 inline h-4 w-4" />
            출발지
          </legend>
          <input
            type="text"
            placeholder="주소 (예: 서울특별시 강남구 ...)"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            required
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="number"
              step="0.0000001"
              placeholder="위도 (예: 37.4979)"
              value={form.lat}
              onChange={(e) => setForm({ ...form, lat: e.target.value })}
              className="rounded border border-gray-300 px-3 py-2 text-sm"
              required
            />
            <input
              type="number"
              step="0.0000001"
              placeholder="경도 (예: 127.0276)"
              value={form.lng}
              onChange={(e) => setForm({ ...form, lng: e.target.value })}
              className="rounded border border-gray-300 px-3 py-2 text-sm"
              required
            />
          </div>
        </fieldset>

        {/* 반경 / 날짜 / 기간 */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="text-sm font-medium">반경</span>
            <select
              value={form.radius_km}
              onChange={(e) =>
                setForm({ ...form, radius_km: parseInt(e.target.value, 10) })
              }
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
            >
              {[5, 10, 20, 30, 50].map((r) => (
                <option key={r} value={r}>
                  {r} km
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-medium">날짜</span>
            <input
              type="date"
              value={form.scheduled_date}
              min={today()}
              onChange={(e) =>
                setForm({ ...form, scheduled_date: e.target.value })
              }
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
              required
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium">기간</span>
            <select
              value={form.duration_days}
              onChange={(e) =>
                setForm({ ...form, duration_days: parseInt(e.target.value, 10) })
              }
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
            >
              <option value={1}>당일</option>
              <option value={2}>1박 2일</option>
              <option value={3}>2박 3일</option>
            </select>
          </label>
        </div>

        {/* 그룹 선택 */}
        <label className="block">
          <span className="text-sm font-medium">동반 그룹</span>
          <select
            value={form.group_id}
            onChange={(e) => setForm({ ...form, group_id: e.target.value })}
            disabled={profilesLoading}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50"
            required
          >
            <option value="">— 그룹 선택 —</option>
            {groups.map((g) => (
              <option key={g.group_id} value={g.group_id}>
                {g.name}
              </option>
            ))}
          </select>
          {!profilesLoading && groups.length === 0 && (
            <p className="mt-1 text-xs text-amber-600">
              생성된 그룹이 없습니다. 먼저 프로필에서 그룹을 만들어주세요.
            </p>
          )}
        </label>

        {/* 분위기 태그 */}
        <div>
          <span className="text-sm font-medium">분위기 (선택)</span>
          <div className="mt-2 flex flex-wrap gap-2">
            {MOOD_TAG_PRESETS.map((tag) => {
              const active = form.mood_tags.includes(tag);
              return (
                <button
                  type="button"
                  key={tag}
                  onClick={() => toggleMoodTag(tag)}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    active
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-gray-300 bg-white text-gray-700 hover:border-blue-400"
                  }`}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </div>

        {/* 추가 메모 */}
        <label className="block">
          <span className="text-sm font-medium">추가 메모 (선택)</span>
          <textarea
            value={form.additional_notes}
            onChange={(e) =>
              setForm({ ...form, additional_notes: e.target.value })
            }
            rows={3}
            maxLength={2000}
            placeholder="예: 점심은 한식으로, 카페 한 곳 포함, ..."
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </label>

        {/* 에러 표시 */}
        {creditError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            크레딧이 부족합니다. (필요 {creditError.required} / 보유{" "}
            {creditError.available})
          </div>
        )}
        {lastError && !creditError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {lastError}
          </div>
        )}

        {/* 제출 */}
        <button
          type="submit"
          disabled={!valid || submitting}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-gray-300"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {submitting ? "요청 보내는 중..." : `코스 생성 (${creditsRequired} 크레딧)`}
        </button>
      </form>
    </div>
  );
};

export default GeneratorForm;
