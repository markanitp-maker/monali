import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

interface CountdownTimerProps {
  /** ISO timestamp */
  deadline: string | null;
  onExpire?: () => void;
}

interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  totalMs: number;
}

function computeTimeLeft(deadlineMs: number): TimeLeft {
  const totalMs = Math.max(0, deadlineMs - Date.now());
  const totalSec = Math.floor(totalMs / 1000);
  return {
    days: Math.floor(totalSec / 86400),
    hours: Math.floor((totalSec % 86400) / 3600),
    minutes: Math.floor((totalSec % 3600) / 60),
    seconds: totalSec % 60,
    totalMs,
  };
}

const pad = (n: number) => n.toString().padStart(2, "0");

export function CountdownTimer({ deadline, onExpire }: CountdownTimerProps) {
  const deadlineMs = deadline ? new Date(deadline).getTime() : null;
  const [tl, setTl] = useState<TimeLeft | null>(
    deadlineMs ? computeTimeLeft(deadlineMs) : null,
  );

  useEffect(() => {
    if (!deadlineMs) return;
    const tick = () => {
      const next = computeTimeLeft(deadlineMs);
      setTl(next);
      if (next.totalMs === 0) {
        onExpire?.();
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadlineMs, onExpire]);

  if (!deadline || !tl) {
    return (
      <div className="inline-flex items-center gap-2 text-sm text-gray-500">
        <Clock className="w-4 h-4" />
        <span>마감 시간 미설정</span>
      </div>
    );
  }

  if (tl.totalMs === 0) {
    return (
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-gray-200 text-gray-700 text-sm font-medium">
        <Clock className="w-4 h-4" />
        <span>투표 마감</span>
      </div>
    );
  }

  const isUrgent = tl.totalMs <= 10 * 60 * 1000; // 마감 10분 전
  const colorCls = isUrgent
    ? "bg-red-50 text-red-700 border-red-200 animate-pulse"
    : "bg-blue-50 text-blue-700 border-blue-200";

  return (
    <div
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-medium tabular-nums ${colorCls}`}
      role="timer"
      aria-label="투표 마감 카운트다운"
    >
      <Clock className="w-4 h-4" />
      <span>
        {tl.days > 0 && `${tl.days}일 `}
        {pad(tl.hours)}:{pad(tl.minutes)}:{pad(tl.seconds)}
      </span>
    </div>
  );
}
