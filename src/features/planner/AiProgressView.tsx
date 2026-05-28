import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlertCircle, CheckCircle2, Loader2, RotateCcw } from "lucide-react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import {
  AI_PIPELINE_STEPS,
  AI_PIPELINE_STEP_LABEL,
  type AiPipelineStep,
  type AiTask,
  type AiTaskStatus,
  computeProgress,
  stepIndex,
} from "@/types/course";

/**
 * AI 진행 상태 뷰
 * - 라우트 파라미터 task_id 로 ai_tasks 직접 SELECT (초기 상태)
 * - 채널 "ai_task:{task_id}" 구독해 단계별 UPDATE 수신
 * - COMPLETED → /planner/:planId 로 자동 이동 (코스 비교)
 * - FAILED → 에러 + 재시도 버튼
 */
export const AiProgressView = () => {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();

  const [task, setTask] = useState<Partial<AiTask> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!taskId) return;

    const init = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("ai_tasks")
        .select("*")
        .eq("task_id", taskId)
        .single();
      if (error) {
        setLoadError(error.message);
      } else {
        setTask(data as AiTask);
      }
      setLoading(false);
    };
    void init();

    const channel = supabase
      .channel(`ai_task:${taskId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "ai_tasks",
          filter: `task_id=eq.${taskId}`,
        },
        (payload) => {
          setTask((prev) => ({ ...(prev ?? {}), ...payload.new }) as AiTask);
        },
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        void supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [taskId]);

  // COMPLETED 시 자동 이동
  useEffect(() => {
    if (task?.status === "COMPLETED" && task.plan_id) {
      const timer = setTimeout(() => {
        navigate(`/planner/${task.plan_id}`);
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [task?.status, task?.plan_id, navigate]);

  if (!taskId) {
    return <ErrorView message="task_id 파라미터가 없습니다" />;
  }
  if (loading) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-600" />
        <p className="mt-3 text-sm text-gray-500">진행 상태 불러오는 중...</p>
      </div>
    );
  }
  if (loadError) {
    return <ErrorView message={loadError} />;
  }
  if (!task) {
    return <ErrorView message="작업을 찾을 수 없습니다" />;
  }

  const status = (task.status ?? "RUNNING") as AiTaskStatus;
  const currentStep = (task.current_step ?? "skeleton") as AiPipelineStep;
  const progress = computeProgress(currentStep, status);
  const currentIdx = stepIndex(currentStep);

  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <header className="mb-8 text-center">
        <h1 className="text-xl font-bold">AI 코스 생성 중</h1>
        <p className="mt-1 text-sm text-gray-500">
          {status === "RUNNING" && "잠시만 기다려주세요 (약 90초)"}
          {status === "COMPLETED" && "완료! 결과 화면으로 이동합니다..."}
          {status === "PAUSED" && "일시 중단되었습니다"}
          {status === "FAILED" && "생성에 실패했습니다"}
        </p>
      </header>

      {/* 진행 바 */}
      <div className="mb-8 h-2 w-full overflow-hidden rounded-full bg-gray-200">
        <div
          className={`h-full transition-all duration-500 ${
            status === "FAILED" ? "bg-red-500" : "bg-blue-600"
          }`}
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>

      {/* 단계 목록 */}
      <ol className="space-y-3">
        {AI_PIPELINE_STEPS.map((step, idx) => {
          const done = idx < currentIdx || status === "COMPLETED";
          const active = idx === currentIdx && status === "RUNNING";
          const failed = idx === currentIdx && status === "FAILED";
          return (
            <li
              key={step}
              className={`flex items-center gap-3 rounded-lg border p-3 transition ${
                active
                  ? "border-blue-400 bg-blue-50"
                  : done
                    ? "border-green-200 bg-green-50"
                    : failed
                      ? "border-red-300 bg-red-50"
                      : "border-gray-200 bg-white"
              }`}
            >
              <StepIcon done={done} active={active} failed={failed} />
              <div className="flex-1">
                <p className="text-sm font-medium">
                  {AI_PIPELINE_STEP_LABEL[step]}
                </p>
                <p className="text-xs text-gray-500">단계 {idx + 1} / 6 — {step}</p>
              </div>
            </li>
          );
        })}
      </ol>

      {/* 에러 표시 */}
      {(status === "FAILED" || status === "PAUSED") && (
        <div className="mt-8 rounded-lg border border-red-200 bg-red-50 p-4">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-5 w-5 text-red-600" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-red-800">
                {status === "FAILED" ? "오류 발생" : "일시 중단"}
              </p>
              {task.last_error && (
                <p className="mt-1 text-xs text-red-700">{task.last_error}</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => navigate("/planner/new")}
            className="mt-3 inline-flex items-center gap-2 rounded bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            다시 시도
          </button>
        </div>
      )}
    </div>
  );
};

const StepIcon = ({
  done,
  active,
  failed,
}: {
  done: boolean;
  active: boolean;
  failed: boolean;
}) => {
  if (failed) return <AlertCircle className="h-5 w-5 text-red-600" />;
  if (done) return <CheckCircle2 className="h-5 w-5 text-green-600" />;
  if (active) return <Loader2 className="h-5 w-5 animate-spin text-blue-600" />;
  return <div className="h-5 w-5 rounded-full border-2 border-gray-300" />;
};

const ErrorView = ({ message }: { message: string }) => (
  <div className="mx-auto max-w-xl px-4 py-16 text-center">
    <AlertCircle className="mx-auto h-8 w-8 text-red-600" />
    <p className="mt-3 text-sm text-red-700">{message}</p>
  </div>
);

export default AiProgressView;
