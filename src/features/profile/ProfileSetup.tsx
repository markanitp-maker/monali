import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Minus,
  Plus,
  Users,
  UsersRound,
} from "lucide-react";
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

type Step = 1 | 2 | 3 | 4;

interface ProfileSetupProps {
  onComplete?: (result: { companions: Companion[]; group: Group | null }) => void;
}

/**
 * 4단계 온보딩 마법사
 *  1) 구성원 수 결정
 *  2) 각 구성원 정보 입력
 *  3) (선택) 그룹 생성 + 멤버 지정
 *  4) 확인 및 저장
 */
export const ProfileSetup = ({ onComplete }: ProfileSetupProps) => {
  const { saveCompanions, createGroup, addGroupMembers, loading, error } =
    useProfiles();

  const [step, setStep] = useState<Step>(1);
  const [members, setMembers] = useState<CreateCompanionInput[]>([emptyMember()]);
  const [activeIndex, setActiveIndex] = useState(0);

  const [groupEnabled, setGroupEnabled] = useState(false);
  const [groupName, setGroupName] = useState("우리 가족");
  const [groupColor, setGroupColor] = useState("#3B82F6");

  const memberCount = members.length;

  const updateCount = (n: number) => {
    const clamped = Math.max(1, Math.min(10, n));
    setMembers((prev) => {
      if (clamped > prev.length) {
        return [...prev, ...Array.from({ length: clamped - prev.length }, emptyMember)];
      }
      return prev.slice(0, clamped);
    });
    setActiveIndex((i) => Math.min(i, clamped - 1));
  };

  const updateMember = (idx: number, next: CreateCompanionInput) =>
    setMembers((prev) => prev.map((m, i) => (i === idx ? next : m)));

  const canProceedFromStep2 = members.every((m) => m.name.trim().length > 0);

  const handleSubmit = async () => {
    try {
      const savedCompanions = await saveCompanions(members);
      let group: Group | null = null;
      if (groupEnabled && groupName.trim().length > 0) {
        group = await createGroup(groupName.trim(), groupColor);
        if (savedCompanions.length > 0) {
          await addGroupMembers(
            group.group_id,
            savedCompanions.map((c) => c.profile_id),
          );
        }
      }
      onComplete?.({ companions: savedCompanions, group });
    } catch {
      // error 는 useProfiles 의 error state 에 노출됨
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      {/* 진행 표시 */}
      <div className="flex items-center justify-between mb-8">
        {[1, 2, 3, 4].map((s) => (
          <div key={s} className="flex items-center flex-1">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${
                step >= s ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-500"
              }`}
            >
              {step > s ? <Check size={16} /> : s}
            </div>
            {s < 4 && (
              <div
                className={`flex-1 h-0.5 mx-2 ${step > s ? "bg-blue-600" : "bg-gray-200"}`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step 1: 구성원 수 */}
      {step === 1 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-2">
            <Users className="text-blue-600" />
            <h2 className="text-xl font-bold text-gray-900">
              함께 나들이할 구성원 수
            </h2>
          </div>
          <p className="text-sm text-gray-600 mb-6">
            나들이에 함께할 가족 구성원 수를 알려주세요. 다음 단계에서 각자의 정보를
            입력합니다.
          </p>

          <div className="flex items-center justify-center gap-4 py-8">
            <button
              type="button"
              onClick={() => updateCount(memberCount - 1)}
              disabled={memberCount <= 1}
              className="w-12 h-12 rounded-full border border-gray-300 flex items-center justify-center disabled:opacity-30 hover:bg-gray-50"
            >
              <Minus />
            </button>
            <div className="text-5xl font-bold text-gray-900 w-20 text-center">
              {memberCount}
            </div>
            <button
              type="button"
              onClick={() => updateCount(memberCount + 1)}
              disabled={memberCount >= 10}
              className="w-12 h-12 rounded-full border border-gray-300 flex items-center justify-center disabled:opacity-30 hover:bg-gray-50"
            >
              <Plus />
            </button>
          </div>
          <p className="text-center text-xs text-gray-500 mb-6">
            최소 1명, 최대 10명
          </p>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              다음 <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Step 2: 각 구성원 정보 */}
      {step === 2 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-1">
            구성원 정보 ({activeIndex + 1} / {memberCount})
          </h2>
          <p className="text-sm text-gray-600 mb-4">
            제약 사항이 없어도 괜찮습니다. "해당 없음"을 선택하세요.
          </p>

          {memberCount > 1 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {members.map((m, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setActiveIndex(i)}
                  className={`px-3 py-1 text-sm rounded-full border ${
                    i === activeIndex
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white border-gray-300 text-gray-700"
                  }`}
                >
                  {m.name || `구성원 ${i + 1}`}
                </button>
              ))}
            </div>
          )}

          <ConstraintForm
            value={members[activeIndex]}
            onChange={(next) => updateMember(activeIndex, next)}
            highlightSeniorHelp
          />

          <div className="flex justify-between mt-6">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="flex items-center gap-2 px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
            >
              <ArrowLeft size={16} /> 이전
            </button>
            <div className="flex gap-2">
              {activeIndex < memberCount - 1 ? (
                <button
                  type="button"
                  onClick={() => setActiveIndex((i) => i + 1)}
                  disabled={!members[activeIndex].name.trim()}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-800 rounded-lg disabled:opacity-50 hover:bg-gray-200"
                >
                  다음 구성원 <ArrowRight size={16} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  disabled={!canProceedFromStep2}
                  className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50 hover:bg-blue-700"
                >
                  다음 <ArrowRight size={16} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Step 3: 그룹 설정 (선택) */}
      {step === 3 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-2">
            <UsersRound className="text-blue-600" />
            <h2 className="text-xl font-bold text-gray-900">그룹 만들기 (선택)</h2>
          </div>
          <p className="text-sm text-gray-600 mb-6">
            여러 가족과 함께 다닌다면 그룹으로 묶으면 편리합니다. 지금 건너뛰어도
            나중에 만들 수 있어요.
          </p>

          <label className="flex items-center gap-2 mb-4">
            <input
              type="checkbox"
              checked={groupEnabled}
              onChange={(e) => setGroupEnabled(e.target.checked)}
              className="w-4 h-4"
            />
            <span className="text-sm text-gray-800">지금 그룹 만들기</span>
          </label>

          {groupEnabled && (
            <GroupForm
              name={groupName}
              color={groupColor}
              onChangeName={setGroupName}
              onChangeColor={setGroupColor}
            />
          )}

          <div className="flex justify-between mt-6">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="flex items-center gap-2 px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
            >
              <ArrowLeft size={16} /> 이전
            </button>
            <button
              type="button"
              onClick={() => setStep(4)}
              className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              확인하기 <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Step 4: 확인 */}
      {step === 4 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-1">입력 내용 확인</h2>
          <p className="text-sm text-gray-600 mb-4">
            아래 내용으로 저장합니다. 추후 설정에서 언제든 수정할 수 있습니다.
          </p>

          <div className="space-y-3 mb-6">
            {members.map((m, i) => (
              <MemberCard
                key={i}
                member={m}
                onEdit={() => {
                  setStep(2);
                  setActiveIndex(i);
                }}
              />
            ))}
          </div>

          {groupEnabled && groupName.trim().length > 0 && (
            <div className="mb-4 p-3 rounded-lg border border-gray-200 flex items-center gap-2">
              <span
                className="inline-block w-4 h-4 rounded-full border border-gray-300"
                style={{ backgroundColor: groupColor }}
              />
              <span className="text-sm text-gray-800">
                그룹 <strong>{groupName}</strong> 생성 + {members.length}명 추가
              </span>
            </div>
          )}

          {members.some((m) => m.digital_level === "LOW") && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900">
              디지털 친숙도 "낮음" 구성원이 있어 <strong>Simple View</strong>가 자동
              적용됩니다.
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex justify-between">
            <button
              type="button"
              onClick={() => setStep(3)}
              className="flex items-center gap-2 px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
            >
              <ArrowLeft size={16} /> 수정하기
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={loading}
              className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50 hover:bg-blue-700"
            >
              <Check size={16} /> {loading ? "저장 중..." : "저장하기"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
