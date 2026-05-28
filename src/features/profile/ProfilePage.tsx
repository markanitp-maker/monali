import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronDown,
  ChevronUp,
  LogOut,
  Pencil,
  Plus,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { ConstraintForm } from "./ConstraintForm";
import { GroupForm } from "./GroupForm";
import { MemberCard } from "./MemberCard";
import { useProfiles } from "./useProfiles";
import type { Companion, CreateCompanionInput, Group } from "@/types/profile";

const emptyMember = (): CreateCompanionInput => ({
  name: "",
  mobility_constraint: "NONE",
  dietary_restriction: "NONE",
  digital_level: "MID",
  preference_tags: [],
  allergies: [],
  constraint_details: {},
});

// ─── 구성원 편집 모달 ────────────────────────────────────────────────────────
const CompanionModal = ({
  initial,
  onSave,
  onClose,
  saving,
}: {
  initial: CreateCompanionInput;
  onSave: (v: CreateCompanionInput) => void;
  onClose: () => void;
  saving: boolean;
}) => {
  const [value, setValue] = useState<CreateCompanionInput>(initial);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100">
          <h3 className="font-bold text-gray-900">구성원 정보 편집</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>
        <div className="p-5">
          <ConstraintForm value={value} onChange={setValue} highlightSeniorHelp />
        </div>
        <div className="flex gap-2 px-5 pb-5">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => onSave(value)}
            disabled={!value.name.trim() || saving}
            className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── 그룹 편집 모달 ──────────────────────────────────────────────────────────
const GroupModal = ({
  initial,
  companions,
  memberIds,
  onSave,
  onClose,
  saving,
}: {
  initial: { name: string; color: string };
  companions: Companion[];
  memberIds: Set<string>;
  onSave: (name: string, color: string, selected: Set<string>) => void;
  onClose: () => void;
  saving: boolean;
}) => {
  const [name, setName] = useState(initial.name);
  const [color, setColor] = useState(initial.color);
  const [selected, setSelected] = useState<Set<string>>(new Set(memberIds));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100">
          <h3 className="font-bold text-gray-900">그룹 편집</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>
        <div className="p-5 space-y-5">
          <GroupForm name={name} color={color} onChangeName={setName} onChangeColor={setColor} />
          {companions.length > 0 && (
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">구성원 선택</p>
              <div className="space-y-2">
                {companions.map((c) => (
                  <label key={c.profile_id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selected.has(c.profile_id)}
                      onChange={() => toggle(c.profile_id)}
                      className="w-4 h-4 rounded accent-blue-600"
                    />
                    <span className="text-sm text-gray-800">{c.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="flex gap-2 px-5 pb-5">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => onSave(name, color, selected)}
            disabled={!name.trim() || saving}
            className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── 메인 페이지 ─────────────────────────────────────────────────────────────
export const ProfilePage = () => {
  const navigate = useNavigate();
  const {
    companions,
    groups,
    loading,
    error,
    saveCompanions,
    updateCompanion,
    deleteCompanion,
    createGroup,
    updateGroup,
    deleteGroup,
    addGroupMembers,
    removeGroupMember,
    refresh,
  } = useProfiles();

  // 구성원 모달
  const [companionModal, setCompanionModal] = useState<{
    mode: "add" | "edit";
    companion?: Companion;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  // 그룹 모달
  const [groupModal, setGroupModal] = useState<{
    mode: "add" | "edit";
    group?: Group;
  } | null>(null);

  // 그룹 펼침
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  // 삭제 확인
  const [deleteTarget, setDeleteTarget] = useState<
    { type: "companion"; id: string; name: string } |
    { type: "group"; id: string; name: string } | null
  >(null);

  const handleSaveCompanion = async (value: CreateCompanionInput) => {
    setSaving(true);
    try {
      if (companionModal?.mode === "edit" && companionModal.companion) {
        await updateCompanion(companionModal.companion.profile_id, value);
      } else {
        await saveCompanions([value]);
      }
      setCompanionModal(null);
    } catch {
      // error는 useProfiles state에 노출됨
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      if (deleteTarget.type === "companion") {
        await deleteCompanion(deleteTarget.id);
      } else {
        await deleteGroup(deleteTarget.id);
      }
      setDeleteTarget(null);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  const handleSaveGroup = async (
    name: string,
    color: string,
    selected: Set<string>,
  ) => {
    setSaving(true);
    try {
      if (groupModal?.mode === "edit" && groupModal.group) {
        const gid = groupModal.group.group_id;
        await updateGroup(gid, name, color);

        // 현재 멤버 조회 후 diff
        const { data: currentMembers } = await supabase
          .from("group_members")
          .select("companion_id")
          .eq("group_id", gid);
        const currentIds = new Set((currentMembers ?? []).map((m: { companion_id: string }) => m.companion_id));

        const toAdd = [...selected].filter((id) => !currentIds.has(id));
        const toRemove = [...currentIds].filter((id) => !selected.has(id));

        const ops = [
          ...(toAdd.length > 0 ? [addGroupMembers(gid, toAdd)] : []),
          ...toRemove.map((id) => removeGroupMember(gid, id)),
        ];
        await Promise.allSettled(ops);
      } else {
        const group = await createGroup(name, color);
        if (selected.size > 0) {
          await addGroupMembers(group.group_id, [...selected]);
        }
      }
      setGroupModal(null);
      await refresh();
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/onboarding", { replace: true });
  };

  return (
    <div className="px-4 py-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">프로필</h1>
        <button
          type="button"
          onClick={() => void handleSignOut()}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-red-600 transition"
        >
          <LogOut size={16} />
          로그아웃
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {/* 구성원 섹션 */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Users size={18} className="text-blue-600" />
            구성원 <span className="text-sm font-normal text-gray-400">({companions.length}명)</span>
          </h2>
          <button
            type="button"
            onClick={() => setCompanionModal({ mode: "add" })}
            className="flex items-center gap-1.5 text-sm text-blue-600 font-medium hover:text-blue-700"
          >
            <UserPlus size={16} />
            추가
          </button>
        </div>

        {loading ? (
          <div className="text-center py-8 text-sm text-gray-400">불러오는 중...</div>
        ) : companions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center">
            <p className="text-sm text-gray-500 mb-3">등록된 구성원이 없습니다</p>
            <button
              type="button"
              onClick={() => setCompanionModal({ mode: "add" })}
              className="text-sm text-blue-600 font-medium hover:underline"
            >
              + 구성원 추가하기
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {companions.map((c) => (
              <MemberCard
                key={c.profile_id}
                member={c}
                onEdit={() => setCompanionModal({ mode: "edit", companion: c })}
                onRemove={() => setDeleteTarget({ type: "companion", id: c.profile_id, name: c.name })}
              />
            ))}
          </div>
        )}
      </section>

      {/* 그룹 섹션 */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Users size={18} className="text-purple-600" />
            그룹 <span className="text-sm font-normal text-gray-400">({groups.length}개)</span>
          </h2>
          <button
            type="button"
            onClick={() => setGroupModal({ mode: "add" })}
            className="flex items-center gap-1.5 text-sm text-purple-600 font-medium hover:text-purple-700"
          >
            <Plus size={16} />
            추가
          </button>
        </div>

        {groups.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center">
            <p className="text-sm text-gray-500 mb-3">등록된 그룹이 없습니다</p>
            <button
              type="button"
              onClick={() => setGroupModal({ mode: "add" })}
              className="text-sm text-purple-600 font-medium hover:underline"
            >
              + 그룹 만들기
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {groups.map((g) => (
              <div key={g.group_id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <div className="flex items-center gap-3 p-4">
                  <span
                    className="w-4 h-4 rounded-full shrink-0"
                    style={{ backgroundColor: g.color }}
                  />
                  <span className="flex-1 font-medium text-gray-900">{g.name}</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setGroupModal({ mode: "edit", group: g })}
                      className="p-1.5 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-blue-50"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget({ type: "group", id: g.group_id, name: g.name })}
                      className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50"
                    >
                      <Trash2 size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedGroup((prev) => (prev === g.group_id ? null : g.group_id))
                      }
                      className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-50"
                    >
                      {expandedGroup === g.group_id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                  </div>
                </div>
                {expandedGroup === g.group_id && (
                  <GroupMemberList groupId={g.group_id} companions={companions} />
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 구성원 모달 */}
      {companionModal && (
        <CompanionModal
          initial={
            companionModal.mode === "edit" && companionModal.companion
              ? {
                  name: companionModal.companion.name,
                  mobility_constraint: companionModal.companion.mobility_constraint,
                  dietary_restriction: companionModal.companion.dietary_restriction,
                  digital_level: companionModal.companion.digital_level,
                  preference_tags: companionModal.companion.preference_tags,
                  allergies: companionModal.companion.allergies,
                  constraint_details: companionModal.companion.constraint_details,
                }
              : emptyMember()
          }
          onSave={(v) => void handleSaveCompanion(v)}
          onClose={() => setCompanionModal(null)}
          saving={saving}
        />
      )}

      {/* 그룹 모달 */}
      {groupModal && (
        <GroupModalLoader
          mode={groupModal.mode}
          group={groupModal.group}
          companions={companions}
          onSave={(name, color, selected) => void handleSaveGroup(name, color, selected)}
          onClose={() => setGroupModal(null)}
          saving={saving}
        />
      )}

      {/* 삭제 확인 */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-xl">
            <h3 className="font-bold text-gray-900 mb-2">
              {deleteTarget.type === "companion" ? "구성원 삭제" : "그룹 삭제"}
            </h3>
            <p className="text-sm text-gray-600 mb-5">
              <strong>{deleteTarget.name}</strong>을(를) 삭제하시겠습니까?
              {deleteTarget.type === "group" && (
                <span className="block mt-1 text-gray-400">그룹 멤버 정보도 함께 삭제됩니다.</span>
              )}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="flex-1 py-2.5 rounded-xl border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmDelete()}
                disabled={saving}
                className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {saving ? "삭제 중..." : "삭제"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── 그룹 멤버 목록 (supabase 직접 조회) ────────────────────────────────────
const GroupMemberList = ({
  groupId,
  companions,
}: {
  groupId: string;
  companions: Companion[];
}) => {
  const [memberIds, setMemberIds] = useState<string[] | null>(null);

  useState(() => {
    void supabase
      .from("group_members")
      .select("companion_id")
      .eq("group_id", groupId)
      .then(({ data }) => {
        setMemberIds((data ?? []).map((m: { companion_id: string }) => m.companion_id));
      });
  });

  const members = memberIds
    ? companions.filter((c) => memberIds.includes(c.profile_id))
    : null;

  return (
    <div className="border-t border-gray-100 px-4 py-3 bg-gray-50">
      {members === null ? (
        <p className="text-xs text-gray-400">불러오는 중...</p>
      ) : members.length === 0 ? (
        <p className="text-xs text-gray-400">구성원이 없습니다</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {members.map((c) => (
            <span key={c.profile_id} className="text-xs px-2.5 py-1 bg-white border border-gray-200 rounded-full text-gray-700">
              {c.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── 그룹 모달 (기존 멤버 로드 후 렌더) ─────────────────────────────────────
const GroupModalLoader = ({
  mode,
  group,
  companions,
  onSave,
  onClose,
  saving,
}: {
  mode: "add" | "edit";
  group?: Group;
  companions: Companion[];
  onSave: (name: string, color: string, selected: Set<string>) => void;
  onClose: () => void;
  saving: boolean;
}) => {
  const [memberIds, setMemberIds] = useState<Set<string> | null>(
    mode === "add" ? new Set() : null,
  );

  useState(() => {
    if (mode === "edit" && group) {
      void supabase
        .from("group_members")
        .select("companion_id")
        .eq("group_id", group.group_id)
        .then(({ data }) => {
          setMemberIds(
            new Set((data ?? []).map((m: { companion_id: string }) => m.companion_id)),
          );
        });
    }
  });

  if (memberIds === null) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div className="bg-white rounded-2xl p-8">
          <p className="text-sm text-gray-500">불러오는 중...</p>
        </div>
      </div>
    );
  }

  return (
    <GroupModal
      initial={{ name: group?.name ?? "", color: group?.color ?? "#3B82F6" }}
      companions={companions}
      memberIds={memberIds}
      onSave={onSave}
      onClose={onClose}
      saving={saving}
    />
  );
};
