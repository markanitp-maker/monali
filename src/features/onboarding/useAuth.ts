import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

type AuthState = "loading" | "unauthenticated" | "authenticated";

interface UseAuthResult {
  state: AuthState;
  session: Session | null;
  user: User | null;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string) => Promise<{ sent: boolean }>;
  signOut: () => Promise<void>;
}

export const useAuth = (): UseAuthResult => {
  const [state, setState] = useState<AuthState>("loading");
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setState(data.session ? "authenticated" : "unauthenticated");
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_, s) => {
      setSession(s);
      setState(s ? "authenticated" : "unauthenticated");
    });

    return () => subscription.unsubscribe();
  }, []);

  const signInWithGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/onboarding` },
    });
  };

  const signInWithEmail = async (email: string): Promise<{ sent: boolean }> => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/onboarding` },
    });
    if (error) throw error;
    return { sent: true };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return {
    state,
    session,
    user: session?.user ?? null,
    signInWithGoogle,
    signInWithEmail,
    signOut,
  };
};
