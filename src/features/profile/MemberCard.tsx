import {
  Accessibility,
  AlertCircle,
  Baby,
  Footprints,
  Leaf,
  Moon,
  Salad,
  Smartphone,
  User,
  Wheat,
} from "lucide-react";
import type {
  Companion,
  CreateCompanionInput,
  DietaryRestriction,
  DigitalLevel,
  MobilityConstraint,
} from "@/types/profile";

type MemberLike = Companion | CreateCompanionInput;

interface MemberCardProps {
  member: MemberLike;
  onEdit?: () => void;
  onRemove?: () => void;
}

const MOBILITY_META: Record<
  MobilityConstraint,
  { label: string; Icon: typeof Accessibility }
> = {
  NONE: { label: "이동 제약 없음", Icon: User },
  WHEELCHAIR: { label: "휠체어", Icon: Accessibility },
  STROLLER: { label: "유모차", Icon: Baby },
  LIMITED: { label: "보행 어려움", Icon: Footprints },
};

const DIETARY_META: Record<
  DietaryRestriction,
  { label: string; Icon: typeof Leaf }
> = {
  NONE: { label: "식이 제한 없음", Icon: User },
  VEGETARIAN: { label: "채식", Icon: Salad },
  VEGAN: { label: "비건", Icon: Leaf },
  HALAL: { label: "할랄", Icon: Moon },
  KOSHER: { label: "코셔", Icon: Wheat },
  ALLERGY: { label: "알러지", Icon: AlertCircle },
};

const DIGITAL_META: Record<DigitalLevel, { label: string; color: string }> = {
  HIGH: { label: "디지털 능숙", color: "bg-gray-100 text-gray-700" },
  MID: { label: "디지털 보통", color: "bg-blue-50 text-blue-700" },
  LOW: { label: "큰 화면 권장", color: "bg-amber-50 text-amber-800" },
};

export const MemberCard = ({ member, onEdit, onRemove }: MemberCardProps) => {
  const mobility = MOBILITY_META[member.mobility_constraint];
  const dietary = DIETARY_META[member.dietary_restriction];
  const digital = DIGITAL_META[member.digital_level];
  const allergies = member.allergies ?? [];
  const hasMobility = member.mobility_constraint !== "NONE";
  const hasDietary = member.dietary_restriction !== "NONE";

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm hover:shadow-md transition">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
            <User size={20} className="text-blue-600" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">
              {member.name || "(이름 없음)"}
            </h3>
            <span
              className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full mt-0.5 ${digital.color}`}
            >
              <Smartphone size={10} />
              {digital.label}
            </span>
          </div>
        </div>
        <div className="flex gap-1">
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="text-xs px-2 py-1 text-gray-600 hover:bg-gray-100 rounded"
            >
              편집
            </button>
          )}
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="text-xs px-2 py-1 text-red-600 hover:bg-red-50 rounded"
            >
              삭제
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {hasMobility && (
          <span className="inline-flex items-center gap-1 text-xs px-2 py-1 bg-blue-50 text-blue-700 rounded-full">
            <mobility.Icon size={12} />
            {mobility.label}
          </span>
        )}
        {hasDietary && (
          <span className="inline-flex items-center gap-1 text-xs px-2 py-1 bg-green-50 text-green-700 rounded-full">
            <dietary.Icon size={12} />
            {dietary.label}
            {member.dietary_restriction === "ALLERGY" && allergies.length > 0 && (
              <span className="text-green-900 font-medium">
                ({allergies.join(", ")})
              </span>
            )}
          </span>
        )}
        {!hasMobility && !hasDietary && (
          <p className="text-xs text-gray-500">특별한 제약 사항 없음</p>
        )}
      </div>
    </div>
  );
};
