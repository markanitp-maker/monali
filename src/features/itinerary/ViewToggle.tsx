import { Eye, Type } from "lucide-react";

export type ItineraryViewMode = "normal" | "simple";

interface ViewToggleProps {
  mode: ItineraryViewMode;
  onChange: (mode: ItineraryViewMode) => void;
}

/**
 * 일반↔단순화 뷰 전환 토글.
 * - 두 개의 라디오 버튼 형태 (a11y aria-pressed)
 * - 단순화 모드 자체에서도 접근 가능해야 하므로 텍스트는 크고 명확하게.
 */
export const ViewToggle = ({ mode, onChange }: ViewToggleProps) => {
  return (
    <div
      role="group"
      aria-label="화면 표시 모드"
      className="no-print inline-flex rounded-lg border border-gray-300 bg-white p-1 shadow-sm"
    >
      <button
        type="button"
        aria-pressed={mode === "normal"}
        onClick={() => onChange("normal")}
        className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
          mode === "normal"
            ? "bg-blue-600 text-white"
            : "text-gray-700 hover:bg-gray-100"
        }`}
      >
        <Eye className="h-4 w-4" aria-hidden />
        일반
      </button>
      <button
        type="button"
        aria-pressed={mode === "simple"}
        onClick={() => onChange("simple")}
        className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
          mode === "simple"
            ? "bg-blue-600 text-white"
            : "text-gray-700 hover:bg-gray-100"
        }`}
      >
        <Type className="h-4 w-4" aria-hidden />
        큰 글씨
      </button>
    </div>
  );
};

export default ViewToggle;
