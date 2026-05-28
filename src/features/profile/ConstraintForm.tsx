import { useId } from "react";
import {
  Accessibility,
  AlertCircle,
  Baby,
  CircleSlash,
  Footprints,
  Leaf,
  Moon,
  Salad,
  Wheat,
} from "lucide-react";
import type {
  CreateCompanionInput,
  DietaryRestriction,
  DigitalLevel,
  MobilityConstraint,
} from "@/types/profile";

interface ConstraintFormProps {
  value: CreateCompanionInput;
  onChange: (next: CreateCompanionInput) => void;
  /** 어르신/노년층 구성원으로 추정 시 digital_level "LOW" 안내 강조 */
  highlightSeniorHelp?: boolean;
}

const MOBILITY_OPTIONS: Array<{
  value: MobilityConstraint;
  label: string;
  Icon: typeof Accessibility;
}> = [
  { value: "NONE", label: "해당 없음", Icon: CircleSlash },
  { value: "WHEELCHAIR", label: "휠체어", Icon: Accessibility },
  { value: "STROLLER", label: "유모차", Icon: Baby },
  { value: "LIMITED", label: "보행 어려움", Icon: Footprints },
];

const DIETARY_OPTIONS: Array<{
  value: DietaryRestriction;
  label: string;
  Icon: typeof Leaf;
}> = [
  { value: "NONE", label: "해당 없음", Icon: CircleSlash },
  { value: "VEGETARIAN", label: "채식", Icon: Salad },
  { value: "VEGAN", label: "비건", Icon: Leaf },
  { value: "HALAL", label: "할랄", Icon: Moon },
  { value: "KOSHER", label: "코셔", Icon: Wheat },
  { value: "ALLERGY", label: "알러지", Icon: AlertCircle },
];

const DIGITAL_OPTIONS: Array<{ value: DigitalLevel; label: string; hint: string }> = [
  { value: "HIGH", label: "능숙", hint: "스마트폰/앱 사용에 능숙해요" },
  { value: "MID", label: "보통", hint: "기본적인 사용은 가능해요" },
  { value: "LOW", label: "낮음", hint: "큰 글씨/간단한 화면이 필요해요" },
];

/** 콤마 구분 문자열 ↔ 배열 변환 */
const splitAllergies = (raw: string): string[] =>
  raw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 20);

export const ConstraintForm = ({
  value,
  onChange,
  highlightSeniorHelp = false,
}: ConstraintFormProps) => {
  const nameId = useId();
  const allergyId = useId();
  const hasAllergy = value.dietary_restriction === "ALLERGY";

  return (
    <div className="space-y-6">
      {/* 이름 */}
      <div>
        <label htmlFor={nameId} className="block text-sm font-medium text-gray-700 mb-1">
          이름 (또는 호칭)
        </label>
        <input
          id={nameId}
          type="text"
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
          placeholder="예: 엄마, 할아버지, 둘째"
          maxLength={50}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
        />
      </div>

      {/* 이동 제약 (단일 선택) */}
      <div>
        <p className="block text-sm font-medium text-gray-700 mb-2">이동 보조 수단</p>
        <div className="flex flex-wrap gap-2">
          {MOBILITY_OPTIONS.map(({ value: v, label, Icon }) => {
            const selected = value.mobility_constraint === v;
            return (
              <button
                key={v}
                type="button"
                onClick={() => onChange({ ...value, mobility_constraint: v })}
                className={`flex items-center gap-2 px-3 py-2 rounded-full border transition ${
                  selected
                    ? "bg-blue-50 border-blue-500 text-blue-700"
                    : "bg-white border-gray-300 text-gray-700 hover:border-gray-400"
                }`}
              >
                <Icon size={16} />
                <span className="text-sm">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 식이 제한 (단일 선택) */}
      <div>
        <p className="block text-sm font-medium text-gray-700 mb-2">식이 제한</p>
        <div className="flex flex-wrap gap-2">
          {DIETARY_OPTIONS.map(({ value: v, label, Icon }) => {
            const selected = value.dietary_restriction === v;
            return (
              <button
                key={v}
                type="button"
                onClick={() => onChange({ ...value, dietary_restriction: v })}
                className={`flex items-center gap-2 px-3 py-2 rounded-full border transition ${
                  selected
                    ? "bg-green-50 border-green-500 text-green-700"
                    : "bg-white border-gray-300 text-gray-700 hover:border-gray-400"
                }`}
              >
                <Icon size={16} />
                <span className="text-sm">{label}</span>
              </button>
            );
          })}
        </div>

        {hasAllergy && (
          <div className="mt-3">
            <label htmlFor={allergyId} className="block text-xs text-gray-600 mb-1">
              알러지 상세 (쉼표로 구분 - 예: 땅콩, 새우, 우유)
            </label>
            <input
              id={allergyId}
              type="text"
              value={(value.allergies ?? []).join(", ")}
              onChange={(e) =>
                onChange({ ...value, allergies: splitAllergies(e.target.value) })
              }
              maxLength={400}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}
      </div>

      {/* 디지털 친숙도 */}
      <div>
        <p className="block text-sm font-medium text-gray-700 mb-2">
          디지털 친숙도
          {highlightSeniorHelp && (
            <span className="ml-2 text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded">
              어르신은 "낮음" 권장 - 큰 글씨/간단한 화면으로 자동 전환됩니다
            </span>
          )}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {DIGITAL_OPTIONS.map(({ value: v, label, hint }) => {
            const selected = value.digital_level === v;
            return (
              <button
                key={v}
                type="button"
                onClick={() => onChange({ ...value, digital_level: v })}
                className={`text-left px-3 py-2 rounded-lg border transition ${
                  selected
                    ? "bg-purple-50 border-purple-500"
                    : "bg-white border-gray-300 hover:border-gray-400"
                }`}
              >
                <div className="text-sm font-medium text-gray-900">{label}</div>
                <div className="text-xs text-gray-600 mt-0.5">{hint}</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
