/**
 * useShare — 비회원 공유 페이지용 커스텀 훅
 *
 * - GET  /functions/v1/share/api/share/:token
 * - POST /functions/v1/share/api/share/:token/identify
 * - POST /functions/v1/share/api/share/:token/vote
 *
 * - guest_token: localStorage `monali_guest_token_{planId}` 키로 저장
 * - Supabase Realtime: votes 테이블 변경 구독 → voteSummaries 실시간 업데이트
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type {
  IdentifyResponse,
  ItemVoteSummary,
  SharePageData,
  Vote,
  VoteInput,
  VoteResponse,
} from "@/types/share";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

const fnBase = () => `${SUPABASE_URL}/functions/v1/share/api`;

const guestKey = (planId: string) => `monali_guest_token_${planId}`;
const guestNameKey = (planId: string) => `monali_guest_name_${planId}`;
const guestMemberKey = (planId: string) => `monali_guest_member_${planId}`;

export interface GuestInfo {
  memberId: string;
  guestToken: string;
  guestName: string;
}

export interface UseShareReturn {
  data: SharePageData | null;
  loading: boolean;
  error: string | null;
  errorCode: string | null;
  guestInfo: GuestInfo | null;
  /** 이름 입력 → guest_token 획득 + localStorage 저장 */
  identify: (guestName: string) => Promise<void>;
  /** 전체 투표 한 번에 제출 (또는 단건 변경) */
  submitVotes: (votes: VoteInput[]) => Promise<VoteResponse>;
  /** 실시간 투표 집계 */
  voteSummaries: ItemVoteSummary[];
  /** 본인이 이미 응답한 vote 맵 (item_id → Vote) */
  myVotesByItem: Map<string, Vote>;
  /** 새로고침 */
  reload: () => Promise<void>;
}

interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

async function callApi<T>(
  path: string,
  init: RequestInit & { guestToken?: string } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  headers.set("apikey", SUPABASE_ANON_KEY);
  headers.set("Authorization", `Bearer ${SUPABASE_ANON_KEY}`);
  if (init.guestToken) headers.set("x-guest-token", init.guestToken);

  const res = await fetch(`${fnBase()}${path}`, { ...init, headers });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    const body = parsed as ApiErrorBody;
    const err = new Error(body?.error?.message ?? `HTTP ${res.status}`) as Error & {
      code?: string;
      status?: number;
    };
    err.code = body?.error?.code;
    err.status = res.status;
    throw err;
  }
  return parsed as T;
}

export function useShare(token: string | undefined): UseShareReturn {
  const [data, setData] = useState<SharePageData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [guestInfo, setGuestInfo] = useState<GuestInfo | null>(null);
  const [voteSummaries, setVoteSummaries] = useState<ItemVoteSummary[]>([]);
  const [myVotes, setMyVotes] = useState<Vote[]>([]);
  const planIdRef = useRef<string | null>(null);

  const loadGuestFromStorage = useCallback((planId: string) => {
    const gt = localStorage.getItem(guestKey(planId));
    const gn = localStorage.getItem(guestNameKey(planId));
    const mid = localStorage.getItem(guestMemberKey(planId));
    if (gt && gn && mid) {
      setGuestInfo({ memberId: mid, guestToken: gt, guestName: gn });
      return gt;
    }
    return null;
  }, []);

  const fetchData = useCallback(async () => {
    if (!token) {
      setLoading(false);
      setError("공유 토큰이 없습니다.");
      return;
    }
    setLoading(true);
    setError(null);
    setErrorCode(null);

    // 첫 호출 시 planId 미정 → guest_token 헤더 없이 시도
    const headers = new Headers();
    // 만약 이전 세션의 planId 가 ref 에 있으면 그것 기반으로 token 첨부
    if (planIdRef.current) {
      const gt = localStorage.getItem(guestKey(planIdRef.current));
      if (gt) headers.set("x-guest-token", gt);
    }

    try {
      const res = await callApi<SharePageData>(`/share/${token}`, {
        method: "GET",
      });
      setData(res);
      planIdRef.current = res.plan.plan_id;
      setVoteSummaries(res.vote_summaries ?? []);
      setMyVotes(res.your_responses ?? []);

      // localStorage 에서 guest 정보 복원
      const gt = loadGuestFromStorage(res.plan.plan_id);

      // 서버측 your_member 정보가 우선
      if (res.your_member && gt) {
        setGuestInfo((prev) => ({
          memberId: res.your_member!.member_id,
          guestToken: gt,
          guestName: res.your_member!.guest_name ?? prev?.guestName ?? "",
        }));
      }

      // guest_token 이 있다면 재요청해서 your_responses 보강
      if (gt && !res.your_member) {
        try {
          const res2 = await callApi<SharePageData>(`/share/${token}`, {
            method: "GET",
            guestToken: gt,
          });
          setData(res2);
          setVoteSummaries(res2.vote_summaries ?? []);
          setMyVotes(res2.your_responses ?? []);
          if (res2.your_member) {
            setGuestInfo({
              memberId: res2.your_member.member_id,
              guestToken: gt,
              guestName:
                res2.your_member.guest_name ??
                localStorage.getItem(guestNameKey(res.plan.plan_id)) ??
                "",
            });
          }
        } catch {
          /* ignore — 토큰이 만료된 경우 신규 identify 유도 */
        }
      }
    } catch (e) {
      const err = e as Error & { code?: string };
      setError(err.message);
      setErrorCode(err.code ?? null);
    } finally {
      setLoading(false);
    }
  }, [token, loadGuestFromStorage]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // ─── Realtime: votes 테이블 변경 구독 ──────────────────────────────────────
  useEffect(() => {
    if (!data?.plan.plan_id) return;
    const planId = data.plan.plan_id;
    // 클라이언트는 plan_members 직접 조회 권한이 없을 수 있으므로
    // votes 채널은 plan_id 기반 필터를 위해 RPC 가 없으면 전체 구독 후 서버 재조회
    const channel = supabase
      .channel(`share-votes-${planId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "votes" },
        () => {
          // 갱신 시 서버 재조회 (간단한 전략)
          void fetchData();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "plan_members", filter: `plan_id=eq.${planId}` },
        () => {
          void fetchData();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [data?.plan.plan_id, fetchData]);

  // ─── identify ──────────────────────────────────────────────────────────────
  const identify = useCallback(
    async (guestName: string) => {
      if (!token || !data?.plan.plan_id) {
        throw new Error("토큰 또는 계획 정보가 없습니다.");
      }
      const planId = data.plan.plan_id;
      const res = await callApi<IdentifyResponse>(`/share/${token}/identify`, {
        method: "POST",
        body: JSON.stringify({ guest_name: guestName }),
      });
      localStorage.setItem(guestKey(planId), res.guest_token);
      localStorage.setItem(guestNameKey(planId), guestName);
      localStorage.setItem(guestMemberKey(planId), res.member_id);
      setGuestInfo({
        memberId: res.member_id,
        guestToken: res.guest_token,
        guestName,
      });
      await fetchData();
    },
    [token, data?.plan.plan_id, fetchData],
  );

  // ─── submitVotes ───────────────────────────────────────────────────────────
  const submitVotes = useCallback(
    async (votes: VoteInput[]) => {
      if (!token) throw new Error("토큰이 없습니다.");
      if (!guestInfo) throw new Error("게스트 인증이 필요합니다.");
      if (votes.length === 0) throw new Error("투표 항목이 없습니다.");
      const res = await callApi<VoteResponse>(`/share/${token}/vote`, {
        method: "POST",
        body: JSON.stringify({
          guest_token: guestInfo.guestToken,
          votes,
        }),
      });
      // 응답으로 본인 투표 즉시 반영
      setMyVotes((prev) => {
        const map = new Map(prev.map((v) => [v.item_id, v]));
        for (const v of res.saved_votes) map.set(v.item_id, v);
        return Array.from(map.values());
      });
      return res;
    },
    [token, guestInfo],
  );

  const myVotesByItem = useMemo(() => {
    const m = new Map<string, Vote>();
    for (const v of myVotes) m.set(v.item_id, v);
    return m;
  }, [myVotes]);

  return {
    data,
    loading,
    error,
    errorCode,
    guestInfo,
    identify,
    submitVotes,
    voteSummaries,
    myVotesByItem,
    reload: fetchData,
  };
}
