import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Calendar, Plus, MapPin, Clock } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Trip } from "@/types/course";

/**
 * 플래너 홈
 * - 최근 여행 계획 목록 (trips 테이블)
 * - "새 코스 만들기" 버튼 → /planner/new (GeneratorForm)
 */
export const PlannerHome = () => {
  const navigate = useNavigate();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      const { data, error: err } = await supabase
        .from("trips")
        .select("*")
        .order("scheduled_date", { ascending: false, nullsFirst: false })
        .limit(20);
      if (err) {
        setError(err.message);
      } else {
        setTrips((data ?? []) as Trip[]);
      }
      setLoading(false);
    };
    void load();
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">나들이 플래너</h1>
          <p className="mt-1 text-sm text-gray-500">
            가족 제약을 반영한 무장애 코스를 AI가 자동으로 설계합니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/planner/new")}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />새 코스 만들기
        </button>
      </header>

      <section>
        <h2 className="mb-3 text-lg font-semibold">최근 계획</h2>

        {loading && (
          <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
            불러오는 중...
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            계획을 불러오지 못했습니다: {error}
          </div>
        )}

        {!loading && !error && trips.length === 0 && (
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-10 text-center">
            <p className="text-sm text-gray-500">아직 생성한 계획이 없습니다.</p>
            <button
              type="button"
              onClick={() => navigate("/planner/new")}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" />첫 코스 만들기
            </button>
          </div>
        )}

        <ul className="space-y-2">
          {trips.map((trip) => (
            <li key={trip.plan_id}>
              <Link
                to={`/planner/${trip.plan_id}`}
                className="block rounded-lg border border-gray-200 bg-white p-4 transition hover:border-blue-400 hover:shadow-sm"
              >
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-base font-semibold">{trip.title}</h3>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                      {trip.scheduled_date && (
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5" />
                          {trip.scheduled_date}
                        </span>
                      )}
                      {trip.origin_address && (
                        <span className="inline-flex items-center gap-1 truncate">
                          <MapPin className="h-3.5 w-3.5" />
                          {trip.origin_address}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {trip.duration_days}일
                      </span>
                    </div>
                  </div>
                  <StatusBadge status={trip.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};

const STATUS_LABEL: Record<Trip["status"], { label: string; tone: string }> = {
  PLANNING: { label: "준비 중", tone: "bg-yellow-100 text-yellow-800" },
  AGREED: { label: "확정", tone: "bg-blue-100 text-blue-800" },
  STARTED: { label: "출발", tone: "bg-purple-100 text-purple-800" },
  COMPLETED: { label: "완료", tone: "bg-green-100 text-green-800" },
  MISSED: { label: "취소", tone: "bg-gray-100 text-gray-600" },
};

const StatusBadge = ({ status }: { status: Trip["status"] }) => {
  const meta = STATUS_LABEL[status];
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${meta.tone}`}
    >
      {meta.label}
    </span>
  );
};

export default PlannerHome;
