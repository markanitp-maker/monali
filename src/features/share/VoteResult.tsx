/**
 * VoteResult — 실시간 합의 현황 요약 배너
 */
import { CheckCircle2, Users } from "lucide-react";
import type { ConsensusSummary } from "@/types/share";

interface VoteResultProps {
  summary: Pick<ConsensusSummary, "total_members" | "responded" | "agreed">;
  /** 현재 사용자 본인이 응답을 마쳤는지 */
  selfResponded: boolean;
}

export function VoteResult({ summary, selfResponded }: VoteResultProps) {
  const { total_members, responded, agreed } = summary;
  const responseRate =
    total_members > 0 ? Math.round((responded / total_members) * 100) : 0;

  return (
    <section
      aria-label="투표 현황"
      className="bg-white rounded-xl border border-gray-200 p-4 space-y-3"
    >
      <div className="flex items-center justify-between">
        <div className="inline-flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Users className="w-4 h-4 text-blue-600" />
          참여 현황
        </div>
        {selfResponded && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-50 text-green-700 text-xs font-medium">
            <CheckCircle2 className="w-3 h-3" /> 내 응답 완료
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-gray-50 rounded-lg py-2">
          <div className="text-xl font-bold text-gray-900">{total_members}</div>
          <div className="text-[11px] text-gray-500 mt-0.5">전체</div>
        </div>
        <div className="bg-blue-50 rounded-lg py-2">
          <div className="text-xl font-bold text-blue-700">{responded}</div>
          <div className="text-[11px] text-blue-600 mt-0.5">응답</div>
        </div>
        <div className="bg-green-50 rounded-lg py-2">
          <div className="text-xl font-bold text-green-700">{agreed}</div>
          <div className="text-[11px] text-green-600 mt-0.5">동의</div>
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex justify-between text-xs text-gray-500">
          <span>응답률</span>
          <span>{responseRate}%</span>
        </div>
        <div className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-all duration-500"
            style={{ width: `${responseRate}%` }}
          />
        </div>
      </div>
    </section>
  );
}
