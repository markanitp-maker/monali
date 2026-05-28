import { useState } from "react";
import { Mail, Loader2 } from "lucide-react";

interface LoginFormProps {
  onGoogle: () => Promise<void>;
  onEmail: (email: string) => Promise<{ sent: boolean }>;
}

export const LoginForm = ({ onGoogle, onEmail }: LoginFormProps) => {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState<"google" | "email" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGoogle = async () => {
    setError(null);
    setLoading("google");
    try {
      await onGoogle();
    } catch {
      setError("Google 로그인 중 오류가 발생했습니다.");
      setLoading(null);
    }
  };

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setError(null);
    setLoading("email");
    try {
      await onEmail(email.trim());
      setSent(true);
    } catch {
      setError("이메일 전송에 실패했습니다. 다시 시도해주세요.");
    } finally {
      setLoading(null);
    }
  };

  if (sent) {
    return (
      <div className="text-center py-8">
        <div className="text-4xl mb-4">📬</div>
        <h3 className="text-lg font-bold text-gray-900 mb-2">이메일을 확인하세요</h3>
        <p className="text-sm text-gray-600">
          <strong>{email}</strong>으로 로그인 링크를 보냈습니다.
          <br />
          링크를 클릭하면 자동으로 로그인됩니다.
        </p>
        <button
          type="button"
          onClick={() => { setSent(false); setEmail(""); }}
          className="mt-4 text-sm text-blue-600 hover:underline"
        >
          다른 이메일로 다시 시도
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Google */}
      <button
        type="button"
        onClick={() => void handleGoogle()}
        disabled={loading !== null}
        className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-gray-300 rounded-xl bg-white hover:bg-gray-50 disabled:opacity-50 transition font-medium text-gray-700"
      >
        {loading === "google" ? (
          <Loader2 size={18} className="animate-spin" />
        ) : (
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path fill="#FFC107" d="M43.6 20H24v8h11.3C33.7 33.6 29.3 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l5.7-5.7C34.3 5.1 29.4 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21c10.5 0 20-8 20-21 0-1.3-.1-2.7-.4-4z" />
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.1 18.9 12 24 12c3.1 0 5.9 1.1 8.1 2.9l5.7-5.7C34.3 5.1 29.4 3 24 3 16.3 3 9.6 7.9 6.3 14.7z" />
            <path fill="#4CAF50" d="M24 45c5.2 0 10-1.9 13.6-5.1l-6.3-5.2C29.5 36.5 26.9 37 24 37c-5.2 0-9.6-3.3-11.2-8H6.1C9.4 37.8 16.2 45 24 45z" />
            <path fill="#1976D2" d="M43.6 20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.7l6.3 5.2C40.9 35.8 44 30.3 44 24c0-1.3-.1-2.7-.4-4z" />
          </svg>
        )}
        Google로 계속하기
      </button>

      <div className="flex items-center gap-3">
        <hr className="flex-1 border-gray-200" />
        <span className="text-xs text-gray-400">또는</span>
        <hr className="flex-1 border-gray-200" />
      </div>

      {/* Magic Link */}
      <form onSubmit={(e) => void handleEmail(e)} className="space-y-3">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="이메일 주소 입력"
          required
          className="w-full px-4 py-3 border border-gray-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
        />
        <button
          type="submit"
          disabled={!email.trim() || loading !== null}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 transition font-medium text-sm"
        >
          {loading === "email" ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Mail size={16} />
          )}
          이메일 링크로 로그인
        </button>
      </form>

      {error && (
        <p className="text-sm text-red-600 text-center">{error}</p>
      )}
    </div>
  );
};
