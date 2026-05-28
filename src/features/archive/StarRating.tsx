import { useState } from "react";
import { Star } from "lucide-react";

interface StarRatingProps {
  value: number;
  onChange?: (value: number) => void;
  /** 읽기 전용 (목록/상세에서 사용) */
  readOnly?: boolean;
  size?: "sm" | "md" | "lg";
}

const SIZE_CLASS: Record<NonNullable<StarRatingProps["size"]>, string> = {
  sm: "h-4 w-4",
  md: "h-6 w-6",
  lg: "h-8 w-8",
};

export const StarRating = ({
  value,
  onChange,
  readOnly = false,
  size = "md",
}: StarRatingProps) => {
  const [hover, setHover] = useState<number | null>(null);
  const displayValue = hover ?? value;
  const sizeClass = SIZE_CLASS[size];

  return (
    <div
      className="inline-flex items-center gap-1"
      onMouseLeave={() => setHover(null)}
      role={readOnly ? "img" : "radiogroup"}
      aria-label={`별점 ${value}점`}
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= displayValue;
        const Component = readOnly ? "span" : "button";
        return (
          <Component
            key={n}
            type={readOnly ? undefined : ("button" as const)}
            disabled={readOnly}
            onMouseEnter={readOnly ? undefined : () => setHover(n)}
            onClick={readOnly ? undefined : () => onChange?.(n)}
            className={
              readOnly
                ? "inline-flex"
                : "inline-flex cursor-pointer transition hover:scale-110"
            }
            aria-label={`${n}점`}
          >
            <Star
              className={`${sizeClass} ${
                filled
                  ? "fill-yellow-400 text-yellow-400"
                  : "fill-none text-gray-300"
              }`}
            />
          </Component>
        );
      })}
    </div>
  );
};

export default StarRating;
