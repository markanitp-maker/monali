import { useId } from "react";
import { Check, Palette } from "lucide-react";

interface GroupFormProps {
  name: string;
  color: string;
  onChangeName: (next: string) => void;
  onChangeColor: (next: string) => void;
  /** 추가 안내 텍스트 */
  hint?: string;
}

/**
 * Tailwind 기본 팔레트 7자리 HEX.
 * groups.color VARCHAR(7) DEFAULT '#3B82F6' (blue-500)
 */
const PALETTE: Array<{ value: string; label: string }> = [
  { value: "#3B82F6", label: "블루" },
  { value: "#10B981", label: "그린" },
  { value: "#F59E0B", label: "앰버" },
  { value: "#EF4444", label: "레드" },
  { value: "#8B5CF6", label: "퍼플" },
  { value: "#EC4899", label: "핑크" },
  { value: "#14B8A6", label: "틸" },
  { value: "#6B7280", label: "그레이" },
];

/**
 * 그룹 생성/편집 폼.
 * - 그룹 이름 (VARCHAR(100))
 * - 색상 (VARCHAR(7) HEX) — 팔레트에서 선택 또는 직접 입력
 */
export const GroupForm = ({
  name,
  color,
  onChangeName,
  onChangeColor,
  hint,
}: GroupFormProps) => {
  const nameId = useId();
  const colorId = useId();

  return (
    <div className="space-y-5">
      <div>
        <label htmlFor={nameId} className="block text-sm font-medium text-gray-700 mb-1">
          그룹 이름
        </label>
        <input
          id={nameId}
          type="text"
          value={name}
          onChange={(e) => onChangeName(e.target.value.slice(0, 100))}
          placeholder="예: 친가 가족, 외갓집 모임, 둘째네"
          maxLength={100}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
        />
        {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
      </div>

      <div>
        <p className="block text-sm font-medium text-gray-700 mb-2">
          <span className="inline-flex items-center gap-1">
            <Palette size={14} /> 그룹 색상
          </span>
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          {PALETTE.map(({ value, label }) => {
            const selected = color.toUpperCase() === value.toUpperCase();
            return (
              <button
                key={value}
                type="button"
                onClick={() => onChangeColor(value)}
                aria-label={label}
                title={label}
                className={`relative w-9 h-9 rounded-full border-2 transition ${
                  selected
                    ? "border-gray-900 scale-110"
                    : "border-gray-200 hover:border-gray-400"
                }`}
                style={{ backgroundColor: value }}
              >
                {selected && (
                  <Check
                    size={16}
                    className="absolute inset-0 m-auto text-white drop-shadow"
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* 직접 입력 */}
        <div className="flex items-center gap-2">
          <label htmlFor={colorId} className="text-xs text-gray-600">
            직접 입력
          </label>
          <input
            id={colorId}
            type="text"
            value={color}
            onChange={(e) => {
              const v = e.target.value;
              if (/^#?[0-9A-Fa-f]{0,6}$/.test(v)) {
                onChangeColor(v.startsWith("#") ? v : `#${v}`);
              }
            }}
            placeholder="#3B82F6"
            maxLength={7}
            className="w-28 px-2 py-1 text-sm font-mono border border-gray-300 rounded outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span
            className="inline-block w-6 h-6 rounded border border-gray-300"
            style={{ backgroundColor: /^#[0-9A-Fa-f]{6}$/.test(color) ? color : "#FFFFFF" }}
          />
        </div>
      </div>
    </div>
  );
};
