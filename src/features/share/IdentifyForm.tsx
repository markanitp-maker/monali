/**
 * IdentifyForm — 비회원 이름 입력 폼
 *
 * 가입 없이 이름만 입력 → guest_token 발급.
 */
import { useState, type FormEvent } from "react";
import { UserCircle2 } from "lucide-react";

interface IdentifyFormProps {
  planTitle: string;
  onSubmit: (guestName: string) => Promise<void>;
}

export function IdentifyForm({ planTitle, onSubmit }: IdentifyFormProps) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handle(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError("이름을 입력해주세요.");
      return;
    }
    if (trimmed.length > 50) {
      setError("이름은 50자 이내로 입력해주세요.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "등록 실패");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-blue-50 to-white px-4">
      <form
        onSubmit={handle}
        className="w-full max-w-md bg-white rounded-2xl shadow-lg p-8 space-y-6"
      >
        <div className="text-center space-y-2">
          <UserCircle2 className="w-16 h-16 text-blue-500 mx-auto" />
          <h1 className="text-2xl font-bold text-gray-900">
            나들이 의견을 들려주세요
          </h1>
          <p className="text-gray-600 text-sm">{planTitle}</p>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="guest-name"
            className="block text-sm font-medium text-gray-700"
          >
            이름 또는 별명
          </label>
          <input
            id="guest-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: 엄마, 둘째 등"
            className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            maxLength={50}
            autoFocus
            disabled={submitting}
          />
          <p className="text-xs text-gray-500">
            가입 없이 의견만 남길 수 있어요. 같은 이름이면 다음에도 이어서 답할 수 있습니다.
          </p>
        </div>

        {error && (
          <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || name.trim().length === 0}
          className="w-full py-3 text-base font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 active:bg-blue-800 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors min-h-[44px]"
        >
          {submitting ? "등록 중..." : "투표 시작하기"}
        </button>

        <p className="text-xs text-center text-gray-500 leading-relaxed">
          마감 시간까지 응답이 없으면 자동으로 동의한 것으로 처리돼요.
          <br />
          언제든 의견을 바꿀 수 있습니다.
        </p>
      </form>
    </div>
  );
}
