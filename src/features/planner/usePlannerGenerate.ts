import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import {
  type AiPipelineStep,
  type AiTask,
  type AiTaskStatus,
  type CreditInsufficientError,
  type GeneratePlanRequest,
  type GeneratePlanResponse202,
  type PlannerGenerateState,
  computeProgress,
} from "@/types/course";

interface UsePlannerGenerateResult extends PlannerGenerateState {
  /** 생성 요청 → 202 응답 수신 → Realtime 구독 시작 */
  generate: (req: GeneratePlanRequest) => Promise<GeneratePlanResponse202>;
  /** 진행 상태 초기화 (재시도 시) */
  reset: () => void;
  /** 크레딧 부족 시 details */
  creditError: CreditInsufficientError["error"]["details"] | null;
}

const INITIAL: PlannerGenerateState = {
  submitting: false,
  taskId: null,
  planId: null,
  currentStep: null,
  status: null,
  progress: 0,
  lastError: null,
};

/**
 * 코스 생성 요청 + Supabase Realtime 진행 추적 통합 훅.
 *
 * - POST /api/planner/generate 호출
 * - 202 응답의 task_id 로 채널 "ai_task:{task_id}" 구독
 * - ai_tasks UPDATE 가 발생할 때마다 currentStep / status / progress 갱신
 * - 컴포넌트 unmount 또는 reset() 호출 시 채널 정리
 */
export const usePlannerGenerate = (): UsePlannerGenerateResult => {
  const [state, setState] = useState<PlannerGenerateState>(INITIAL);
  const [creditError, setCreditError] = useState<
    CreditInsufficientError["error"]["details"] | null
  >(null);

  const channelRef = useRef<RealtimeChannel | null>(null);

  // ─── Realtime 구독 시작 ────────────────────────────────────────────────
  const subscribe = useCallback((taskId: string) => {
    // 기존 채널 정리
    if (channelRef.current) {
      void supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

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
          const row = payload.new as Partial<AiTask>;
          const step = row.current_step as AiPipelineStep | undefined;
          const status = row.status as AiTaskStatus | undefined;
          if (!step || !status) return;
          setState((s) => ({
            ...s,
            currentStep: step,
            status,
            progress: computeProgress(step, status),
            lastError: row.last_error ?? s.lastError,
          }));
        },
      )
      .subscribe();

    channelRef.current = channel;
  }, []);

  // ─── 생성 요청 ─────────────────────────────────────────────────────────
  const generate = useCallback(
    async (req: GeneratePlanRequest): Promise<GeneratePlanResponse202> => {
      setState({ ...INITIAL, submitting: true });
      setCreditError(null);

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setState((s) => ({ ...s, submitting: false, lastError: "로그인이 필요합니다" }));
        throw new Error("로그인이 필요합니다");
      }

      const { data, error } = await supabase.functions.invoke<
        GeneratePlanResponse202 | CreditInsufficientError
      >("planner/generate", {
        method: "POST",
        body: req,
      });

      if (error) {
        // FunctionsHttpError 의 응답 body 를 가능하면 파싱해 402 식별
        const message = error.message ?? "코스 생성 요청 실패";
        const ctxRes = (error as { context?: { response?: Response } })?.context?.response;
        if (ctxRes && ctxRes.status === 402) {
          try {
            const errBody = (await ctxRes.json()) as CreditInsufficientError;
            setCreditError(errBody.error.details);
            setState((s) => ({
              ...s,
              submitting: false,
              lastError: `크레딧 부족 (필요 ${errBody.error.details.required} / 보유 ${errBody.error.details.available})`,
            }));
            throw new Error("CREDIT_INSUFFICIENT");
          } catch {
            /* fallthrough */
          }
        }
        setState((s) => ({ ...s, submitting: false, lastError: message }));
        throw error;
      }

      if (!data || "error" in data) {
        const errBody = data as CreditInsufficientError | undefined;
        if (errBody?.error?.code === "CREDIT_INSUFFICIENT") {
          setCreditError(errBody.error.details);
          setState((s) => ({
            ...s,
            submitting: false,
            lastError: `크레딧 부족 (필요 ${errBody.error.details.required} / 보유 ${errBody.error.details.available})`,
          }));
          throw new Error("CREDIT_INSUFFICIENT");
        }
        setState((s) => ({ ...s, submitting: false, lastError: "응답이 비어있습니다" }));
        throw new Error("Empty response");
      }

      const ok = data as GeneratePlanResponse202;
      setState({
        submitting: false,
        taskId: ok.task_id,
        planId: ok.plan_id,
        currentStep: ok.current_step,
        status: "RUNNING",
        progress: computeProgress(ok.current_step, "RUNNING"),
        lastError: null,
      });

      subscribe(ok.task_id);
      return ok;
    },
    [subscribe],
  );

  const reset = useCallback(() => {
    if (channelRef.current) {
      void supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    setState(INITIAL);
    setCreditError(null);
  }, []);

  // ─── unmount 시 채널 정리 ──────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (channelRef.current) {
        void supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, []);

  return {
    ...state,
    generate,
    reset,
    creditError,
  };
};
