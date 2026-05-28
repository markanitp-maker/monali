import { useCallback } from "react";
import { Printer } from "lucide-react";

interface PrintButtonProps {
  planId: string;
  scheduledDate?: string | null;
  /** 단순화 뷰에서는 더 큰 버튼 */
  size?: "normal" | "large";
  className?: string;
}

/**
 * 인쇄 / PDF 출력 버튼.
 *
 * - window.print() 만 호출 (브라우저 내장 "PDF로 저장" 기능 활용)
 * - 인쇄 직전 document.title 을 파일명 규칙으로 설정 → 브라우저 PDF 기본 파일명에 반영
 * - 출력 후 원래 title 로 복원
 */
export const PrintButton = ({
  planId,
  scheduledDate,
  size = "normal",
  className = "",
}: PrintButtonProps) => {
  const handlePrint = useCallback(() => {
    const dateStr = (scheduledDate ?? new Date().toISOString().slice(0, 10))
      .replace(/-/g, "");
    const shortId = planId.slice(0, 8);
    const fileName = `나들이일정_${shortId}_${dateStr}.pdf`;

    const originalTitle = document.title;
    document.title = fileName.replace(/\.pdf$/, "");

    try {
      window.print();
    } finally {
      // print() 동기 반환 후 즉시 복원 (브라우저별로 비동기일 수 있으나 안전)
      setTimeout(() => {
        document.title = originalTitle;
      }, 1000);
    }
  }, [planId, scheduledDate]);

  const isLarge = size === "large";

  return (
    <button
      type="button"
      onClick={handlePrint}
      className={`no-print inline-flex items-center justify-center gap-2 rounded-lg bg-gray-900 font-semibold text-white shadow-sm transition hover:bg-gray-700 ${
        isLarge ? "px-6 py-4 text-2xl" : "px-4 py-2 text-sm"
      } ${className}`}
      aria-label="일정표 PDF 출력"
    >
      <Printer className={isLarge ? "h-7 w-7" : "h-4 w-4"} aria-hidden />
      {isLarge ? "PDF로 저장" : "PDF 출력"}
    </button>
  );
};

export default PrintButton;
