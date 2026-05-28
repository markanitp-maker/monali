import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { ProfileSetup } from "@/features/profile/ProfileSetup";
import { LoginForm } from "./LoginForm";
import { useAuth } from "./useAuth";

type Phase = "auth-loading" | "login" | "profile-checking" | "setup" | "done";

export const OnboardingPage = () => {
  const navigate = useNavigate();
  const { state: authState, signInWithGoogle, signInWithEmail, user } = useAuth();
  const [phase, setPhase] = useState<Phase>("auth-loading");

  // Auth 상태 확인 → companions 존재 여부 체크
  useEffect(() => {
    if (authState === "loading") {
      setPhase("auth-loading");
      return;
    }
    if (authState === "unauthenticated") {
      setPhase("login");
      return;
    }
    // authenticated → companions 수 확인
    setPhase("profile-checking");
    void (async () => {
      const { count } = await supabase
        .from("companions")
        .select("profile_id", { count: "exact", head: true });
      if ((count ?? 0) > 0) {
        setPhase("done");
      } else {
        setPhase("setup");
      }
    })();
  }, [authState]);

  // done → 플래너로 이동
  useEffect(() => {
    if (phase === "done") {
      navigate("/planner", { replace: true });
    }
  }, [phase, navigate]);

  if (phase === "auth-loading" || phase === "profile-checking") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex flex-col">
      {/* 헤더 */}
      <div className="text-center pt-16 pb-8 px-6">
        <div className="text-5xl mb-3">🌿</div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">모두의 나들이</h1>
        <p className="text-gray-600 text-sm leading-relaxed">
          가족 모두가 편하게 즐길 수 있는
          <br />
          무장애 나들이 코스를 AI가 설계해드립니다
        </p>
      </div>

      <div className="flex-1 px-6 pb-12 max-w-md mx-auto w-full">
        {phase === "login" && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-1 text-center">
              시작하기
            </h2>
            <p className="text-sm text-gray-500 text-center mb-6">
              로그인하고 나들이 코스를 만들어보세요
            </p>
            <LoginForm
              onGoogle={signInWithGoogle}
              onEmail={signInWithEmail}
            />
          </div>
        )}

        {phase === "setup" && (
          <div>
            <div className="mb-6 text-center">
              <p className="text-sm text-gray-500">
                안녕하세요, <strong className="text-gray-800">{user?.email}</strong>
              </p>
              <p className="text-sm text-gray-600 mt-1">
                함께 나들이할 가족 구성원을 알려주세요
              </p>
            </div>
            <ProfileSetup
              onComplete={() => setPhase("done")}
            />
          </div>
        )}
      </div>

      {/* 하단 안내 */}
      {phase === "login" && (
        <p className="text-center text-xs text-gray-400 pb-6 px-4">
          로그인 시 서비스 이용약관 및 개인정보 처리방침에 동의하게 됩니다.
        </p>
      )}
    </div>
  );
};
