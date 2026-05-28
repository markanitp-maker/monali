/**
 * VoteCard — 장소(itinerary_item)별 찬반 투표 카드
 */
import { useEffect, useState } from "react";
import {
  Accessibility,
  Baby,
  Clock,
  MapPin,
  MessageSquare,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import type { ItineraryItem } from "@/types/course";
import type { ItemVoteSummary, Vote } from "@/types/share";

interface VoteCardProps {
  item: ItineraryItem;
  voteSummary: ItemVoteSummary | undefined;
  myVote?: Vote;
  onVote: (
    itemId: string,
    courseId: string,
    isPositive: boolean,
    comment?: string,
  ) => Promise<void> | void;
  disabled?: boolean;
}

const TRANSPORT_LABEL: Record<string, string> = {
  walk: "도보",
  car: "차량",
  public: "대중교통",
};

export function VoteCard({
  item,
  voteSummary,
  myVote,
  onVote,
  disabled,
}: VoteCardProps) {
  const [comment, setComment] = useState<string>(myVote?.comment ?? "");
  const [showComment, setShowComment] = useState<boolean>(
    !!myVote?.comment || (myVote && !myVote.is_positive) === true,
  );
  const [submitting, setSubmitting] = useState<"pos" | "neg" | null>(null);

  useEffect(() => {
    setComment(myVote?.comment ?? "");
  }, [myVote?.comment]);

  const positive = voteSummary?.positive ?? 0;
  const negative = voteSummary?.negative ?? 0;
  const total = positive + negative;
  const positivePct = total > 0 ? Math.round((positive / total) * 100) : 0;

  const isMyPositive = myVote?.is_positive === true;
  const isMyNegative = myVote?.is_positive === false;

  async function handle(isPositive: boolean) {
    if (disabled) return;
    setSubmitting(isPositive ? "pos" : "neg");
    try {
      await onVote(
        item.item_id,
        item.course_id,
        isPositive,
        comment.trim() || undefined,
      );
      if (!isPositive) setShowComment(true);
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <article className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="p-4 sm:p-5 space-y-3">
        {/* 헤더: 순서 + 이름 */}
        <header className="flex items-start gap-3">
          <span className="flex-shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-700 text-sm font-semibold">
            {item.sequence_order}
          </span>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg sm:text-xl font-bold text-gray-900 leading-tight">
              {item.place.name}
            </h3>
            {item.place.category && (
              <p className="text-xs text-gray-500 mt-0.5">
                {item.place.category}
              </p>
            )}
          </div>
        </header>

        {/* 메타 정보 */}
        <div className="space-y-1.5 text-sm text-gray-600">
          {item.place.address && (
            <div className="flex items-start gap-2">
              <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0 text-gray-400" />
              <span className="break-keep">{item.place.address}</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 flex-shrink-0 text-gray-400" />
            <span>
              체류 {item.stay_duration_minutes}분
              {item.transport_duration_minutes != null && (
                <>
                  {" · "}
                  {TRANSPORT_LABEL[item.transport_mode] ?? item.transport_mode}{" "}
                  이동 {item.transport_duration_minutes}분
                </>
              )}
            </span>
          </div>
        </div>

        {/* 접근성 배지 */}
        {(item.place.wheelchair_accessible || item.place.stroller_accessible) && (
          <div className="flex flex-wrap gap-1.5">
            {item.place.wheelchair_accessible && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-50 text-green-700 text-xs font-medium">
                <Accessibility className="w-3 h-3" /> 휠체어
              </span>
            )}
            {item.place.stroller_accessible && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-xs font-medium">
                <Baby className="w-3 h-3" /> 유모차
              </span>
            )}
          </div>
        )}

        {item.notes && (
          <p className="text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2">
            {item.notes}
          </p>
        )}

        {/* 집계 바 */}
        {total > 0 && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-gray-600">
              <span>
                <span className="font-semibold text-blue-600">{positive}</span>{" "}
                찬성
                {" · "}
                <span className="font-semibold text-red-600">{negative}</span>{" "}
                반대
              </span>
              <span className="text-gray-400">{positivePct}%</span>
            </div>
            <div className="w-full h-2 rounded-full bg-red-100 overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: `${positivePct}%` }}
                aria-label={`찬성 ${positivePct}%`}
              />
            </div>
          </div>
        )}

        {/* 댓글 입력 */}
        {showComment && (
          <div className="space-y-1">
            <label
              htmlFor={`comment-${item.item_id}`}
              className="text-xs font-medium text-gray-700 inline-flex items-center gap-1"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              의견 (선택)
            </label>
            <textarea
              id={`comment-${item.item_id}`}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="이유나 대안을 적어주세요"
              maxLength={200}
              rows={2}
              disabled={disabled}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50"
            />
            <p className="text-[10px] text-right text-gray-400">
              {comment.length}/200
            </p>
          </div>
        )}

        {/* 투표 버튼 */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            type="button"
            onClick={() => handle(true)}
            disabled={disabled || submitting !== null}
            aria-pressed={isMyPositive}
            aria-label={`${item.place.name} 찬성`}
            className={`min-h-[48px] flex items-center justify-center gap-2 rounded-lg font-semibold transition-all border-2 ${
              isMyPositive
                ? "bg-blue-600 text-white border-blue-600 shadow-md"
                : "bg-white text-blue-600 border-blue-200 hover:bg-blue-50 active:bg-blue-100"
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <ThumbsUp className="w-5 h-5" />
            <span>{submitting === "pos" ? "..." : "좋아요"}</span>
          </button>
          <button
            type="button"
            onClick={() => handle(false)}
            disabled={disabled || submitting !== null}
            aria-pressed={isMyNegative}
            aria-label={`${item.place.name} 반대`}
            className={`min-h-[48px] flex items-center justify-center gap-2 rounded-lg font-semibold transition-all border-2 ${
              isMyNegative
                ? "bg-red-500 text-white border-red-500 shadow-md"
                : "bg-white text-red-500 border-red-200 hover:bg-red-50 active:bg-red-100"
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <ThumbsDown className="w-5 h-5" />
            <span>{submitting === "neg" ? "..." : "아쉬워요"}</span>
          </button>
        </div>

        {/* 다른 의견 */}
        {voteSummary?.comments && voteSummary.comments.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-blue-600 font-medium select-none">
              다른 의견 보기 ({voteSummary.comments.length})
            </summary>
            <ul className="mt-2 space-y-1.5">
              {voteSummary.comments.map((c, i) => (
                <li
                  key={i}
                  className="px-3 py-2 bg-gray-50 rounded-lg text-gray-700"
                >
                  <strong className="text-gray-900">{c.guest_name}:</strong>{" "}
                  {c.text}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </article>
  );
}
