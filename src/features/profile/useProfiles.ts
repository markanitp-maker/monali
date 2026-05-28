import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type {
  Companion,
  CreateCompanionInput,
  CreateCompanionsResponse,
  Group,
  GroupMember,
  UpdateCompanionInput,
} from "@/types/profile";
import { shouldUseSimpleView } from "@/types/profile";

interface State {
  companions: Companion[];
  groups: Group[];
  loading: boolean;
  error: string | null;
  /** digital_level === "LOW" 구성원이 있으면 true */
  simpleViewRecommended: boolean;
}

interface UseProfilesResult extends State {
  saveCompanions: (inputs: CreateCompanionInput[]) => Promise<Companion[]>;
  updateCompanion: (
    companionId: string,
    patch: UpdateCompanionInput,
  ) => Promise<Companion>;
  createGroup: (name: string, color?: string) => Promise<Group>;
  addGroupMembers: (
    groupId: string,
    companionIds: string[],
  ) => Promise<GroupMember[]>;
  refresh: () => Promise<void>;
}

/**
 * companions/groups 조회 및 변경 훅.
 *
 * - 조회는 Supabase JS client 직접 사용 (RLS 가 본인 행만 노출)
 * - 쓰기는 Edge Function 경유 (`companions`, `groups`)
 */
export const useProfiles = (): UseProfilesResult => {
  const [state, setState] = useState<State>({
    companions: [],
    groups: [],
    loading: true,
    error: null,
    simpleViewRecommended: false,
  });

  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));

    const [cResult, gResult] = await Promise.allSettled([
      supabase
        .from("companions")
        .select("*")
        .order("created_at", { ascending: true }),
      supabase
        .from("groups")
        .select("*")
        .order("created_at", { ascending: true }),
    ]);

    const companions =
      cResult.status === "fulfilled" && !cResult.value.error
        ? ((cResult.value.data ?? []) as Companion[])
        : [];

    const groups =
      gResult.status === "fulfilled" && !gResult.value.error
        ? ((gResult.value.data ?? []) as Group[])
        : [];

    const errors: string[] = [];
    if (cResult.status === "rejected") errors.push("동반자 조회 실패");
    else if (cResult.value.error) errors.push(cResult.value.error.message);
    if (gResult.status === "rejected") errors.push("그룹 조회 실패");
    else if (gResult.value.error) errors.push(gResult.value.error.message);

    setState({
      companions,
      groups,
      loading: false,
      error: errors.length > 0 ? errors.join(", ") : null,
      simpleViewRecommended: shouldUseSimpleView(companions),
    });
  }, []);

  const saveCompanions = useCallback(
    async (inputs: CreateCompanionInput[]): Promise<Companion[]> => {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) throw new Error("로그인이 필요합니다");

        const { data, error } =
          await supabase.functions.invoke<CreateCompanionsResponse>(
            "companions",
            {
              method: "POST",
              body: { companions: inputs },
            },
          );
        if (error) throw error;
        if (!data) throw new Error("응답이 비어있습니다");

        setState((s) => ({
          ...s,
          companions: data.companions,
          loading: false,
          error: null,
          simpleViewRecommended: data.recommendSimpleView,
        }));
        return data.companions;
      } catch (err) {
        const message = err instanceof Error ? err.message : "동반자 저장 실패";
        setState((s) => ({ ...s, loading: false, error: message }));
        throw err;
      }
    },
    [],
  );

  const updateCompanion = useCallback(
    async (
      companionId: string,
      patch: UpdateCompanionInput,
    ): Promise<Companion> => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("로그인이 필요합니다");

      const { data, error } = await supabase.functions.invoke<{
        companion: Companion;
      }>(`companions/${companionId}`, {
        method: "PATCH",
        body: patch,
      });
      if (error) throw error;
      if (!data) throw new Error("응답이 비어있습니다");

      setState((s) => ({
        ...s,
        companions: s.companions.map((c) =>
          c.profile_id === companionId ? data.companion : c,
        ),
        simpleViewRecommended: shouldUseSimpleView(
          s.companions.map((c) =>
            c.profile_id === companionId ? data.companion : c,
          ),
        ),
      }));
      return data.companion;
    },
    [],
  );

  const createGroup = useCallback(
    async (name: string, color?: string): Promise<Group> => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("로그인이 필요합니다");

      const { data, error } = await supabase.functions.invoke<{ group: Group }>(
        "groups",
        { method: "POST", body: { name, color } },
      );
      if (error) throw error;
      if (!data) throw new Error("응답이 비어있습니다");

      setState((s) => ({ ...s, groups: [...s.groups, data.group] }));
      return data.group;
    },
    [],
  );

  const addGroupMembers = useCallback(
    async (
      groupId: string,
      companionIds: string[],
    ): Promise<GroupMember[]> => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("로그인이 필요합니다");

      const { data, error } = await supabase.functions.invoke<{
        members: GroupMember[];
      }>(`groups/${groupId}/members`, {
        method: "POST",
        body: { companionIds },
      });
      if (error) throw error;
      if (!data) throw new Error("응답이 비어있습니다");
      return data.members;
    },
    [],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    ...state,
    saveCompanions,
    updateCompanion,
    createGroup,
    addGroupMembers,
    refresh,
  };
};
