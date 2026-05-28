/**
 * SharePage — 비회원 공유/투표 메인 페이지
 *
 * 라우트: /share/:token
 * 단계:
 *   1. 이름 입력 (localStorage 미보유 시)
 *   2. 코스 투표 (각 장소별 찬반)
 *   3. 제출 완료 안내 + 합의 현황
 */
import { useCallback, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { AlertTriangle, Info, Loader2 } from "lucide-react";

import { CountdownTimer } from "./CountdownTimer";
import { IdentifyForm } from "./IdentifyForm";
import { VoteCard } from "./VoteCard";
import { VoteResult } from "./VoteResult";
import { useShare } from "./useShare";
import type { ConsensusSummary, VoteInput, VoteResponse } from "@/types/share";

export function SharePage() {
  const { token } = useParams<{ token: string }>();
  const {
    data,
    loading,
    error,
    errorCode,
    guestInfo,
    identify,
    submitVotes,
    voteSummaries,
    myVotesByItem,
    reload,
  } = useShare(token);

  const [toast, setToast] = useState<string | null>(null);
  const [consensus, setConsensus] = useState<ConsensusSummary | null>(null);

  const deadlineMs = data?.consensusDeadline
    ? new Date(data.consensusDeadline).getTime()
    : null;
  const expired = deadlineMs != null && deadlineMs <= Date.now();

  const summaryByItem = useMemo(() => {
    const m = new Map<string, (typeof voteSummaries)[number]>();
    for (const s of voteSummaries) m.set(s.item_id, s);
    return m;
  }, [voteSummaries]);

  const handleVote = useCallback(
    async (
      itemId: string,
      courseId: string,
      isPositive: boolean,
      comment?: string,
    ) => {
      const input: VoteInput = {
        course_id: courseId,
        item_id: itemId,
        is_positive: isPositive,
        comment,
      };
      try {
        const res: VoteResponse = await submitVotes([input]);
        setConsensus(res.consensus_status);
        setToast(res.message ?? "저장되었습니다.");
        window.setTimeout(() => setToast(null), 2400);
      } catch (e) {
        setToast(e instanceof Error ? e.message : "저장 실패");
        window.setTimeout(() => setToast(null), 3000);
      }
    },
    [submitVotes],
  );

  // ─── 로딩 ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center space-y-2">
          <Loader2 className="w-8 h-8 text-blue-500 mx-auto animate-spin" />
          <p className="text-sm text-gray-600">공유 페이지를 불러오는 중...</p>
        </div>
      </div>
    );
  }

  // ─── 에러 ─────────────────────────────────────────────────────────────────
  if (error || !data) {
    const isGone =
      errorCode === "SHARE_TOKEN_NOT_FOUND" ||
      errorCode === "SHARE_TOKEN_EXPIRED" ||
      errorCode === "VOTING_CLOSED";
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-8 text-center space-y-4">
          <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto" />
          <h1 className="text-xl font-bold text-gray-900">
            {isGone ? "링크를 사용할 수 없어요" : "오류가 발생했어요"}
          </h1>
          <p className="text-sm text-gray-600">
            {error ?? "알 수 없는 오류"}
          </p>
          <button
            onClick={() => void reload()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors min-h-[44px]"
          >
            다시 시도
          </button>
        </div>
      </div>
    );
  }

  // ─── 이름 입력 ─────────────────────────────────────────────────────────────
  if (!guestInfo) {
    return <IdentifyForm planTitle={data.plan.title} onSubmit={identify} />;
  }

  // ─── 코스 투표 화면 ────────────────────────────────────────────────────────
  const courses = data.courses ?? [];

  return (
    <div className="min-h-screen bg-gray-50 pb-12">
      {/* 상단 고정 헤더 */}
      <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-base font-bold text-gray-900 truncate">
              {data.plan.title}
            </h1>
            <p className="text-xs text-gray-500 truncate">
              {guestInfo.guestName} 님 · 의견을 남겨주세요
            </p>
          </div>
          <CountdownTimer
            deadline={data.consensusDeadline}
            onExpire={() => void reload()}
          />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-4 space-y-4">
        {/* Silent Consent 안내 */}
        <div className="flex items-start gap-2 px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-900">
          <Info className="w-4 h-4 mt-0.5 flex-shrink-0 text-blue-600" />
          <div className="space-y-0.5">
            <p className="font-medium">의견은 언제든 바꿀 수 있어요</p>
            <p className="text-xs text-blue-700">
              마감 시간까지 응답하지 않으시면 자동으로 동의한 것으로 처리됩니다.
            </p>
          </div>
        </div>

        {/* 마감 안내 */}
        {expired && (
          <div className="flex items-start gap-2 px-4 py-3 bg-gray-100 border border-gray-200 rounded-lg text-sm text-gray-700">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-gray-500" />
            <span>투표가 마감되어 더 이상 수정할 수 없습니다.</span>
          </div>
        )}

        {/* 합의 현황 */}
        {consensus && (
          <VoteResult
            summary={consensus}
            selfResponded={myVotesByItem.size > 0}
          />
        )}

        {/* 코스별 카드 */}
        {courses.length === 0 && (
          <div className="text-center py-12 text-gray-500 text-sm">
            아직 코스가 준비되지 않았습니다.
          </div>
        )}

        {courses.map((course) => (
          <section key={course.course_id} className="space-y-3">
            <div className="flex items-baseline justify-between px-1">
              <h2 className="text-base font-bold text-gray-900">
                {course.course_name}
              </h2>
              {course.total_estimated_minutes != null && (
                <span className="text-xs text-gray-500">
                  약 {Math.round(course.total_estimated_minutes / 60)}시간
                </span>
              )}
            </div>
            {course.ai_reasoning && (
              <p className="text-xs text-gray-600 px-1">
                {course.ai_reasoning}
              </p>
            )}
            <div className="space-y-3">
              {course.items.map((item) => (
                <VoteCard
                  key={item.item_id}
                  item={item}
                  voteSummary={summaryByItem.get(item.item_id)}
                  myVote={myVotesByItem.get(item.item_id)}
                  onVote={handleVote}
                  disabled={expired}
                />
              ))}
            </div>
          </section>
        ))}

        <footer className="text-center text-xs text-gray-400 pt-4">
          Monali · 가족 나들이 플래너
        </footer>
      </main>

      {/* 토스트 */}
      {toast && (
        <div
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 px-4 py-2.5 bg-gray-900 text-white text-sm rounded-full shadow-lg animate-fade-in"
          role="status"
        >
          {toast}
        </div>
      )}
    </div>
  );
}

export default SharePage;
