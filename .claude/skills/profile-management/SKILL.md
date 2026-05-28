---
name: profile-management
description: 가족 구성원(companions) 제약 조건 프로필 생성·수정·조회, groups/group_members 관리를 구현한다. companions CRUD, 이동 제약(휠체어·유모차), 식이 제한(알러지·비건), 그룹 관리, 온보딩 UI 작업 시 반드시 이 스킬을 사용할 것.
---

## 테이블 명 (Plan.md 기준)
- `companions` (not `member_profiles`) — `UNIQUE(user_id, name)`
- `groups` — 나들이 그룹
- `group_members` — `UNIQUE(group_id, companion_id)`

## 타입 정의 (src/types/profile.ts)
```typescript
export type MobilityConstraint = "wheelchair" | "stroller" | "walking_difficulty" | "none";
export type DietaryRestriction = "allergy" | "vegan" | "vegetarian" | "halal" | "none";
export type DigitalLevel = "high" | "medium" | "low";

export interface Companion {
  companion_id: string;
  user_id: string;
  name: string;
  mobility_constraint: MobilityConstraint;
  dietary_restriction: DietaryRestriction;
  allergy_details?: string;
  digital_level: DigitalLevel;
  created_at: string;
  updated_at: string;
}

export interface Group {
  group_id: string;
  user_id: string;
  name: string;
  color?: string;
  created_at: string;
}

export interface GroupMember {
  group_id: string;
  companion_id: string;
  companion?: Companion;
}

export interface CreateCompanionInput {
  name: string;
  mobility_constraint: MobilityConstraint;
  dietary_restriction: DietaryRestriction;
  allergy_details?: string;
  digital_level: DigitalLevel;
}
```

## Zod 검증 스키마
```typescript
import { z } from "https://esm.sh/zod@3";

const CompanionSchema = z.object({
  name: z.string().min(1).max(50),
  mobility_constraint: z.enum(["wheelchair", "stroller", "walking_difficulty", "none"]),
  dietary_restriction: z.enum(["allergy", "vegan", "vegetarian", "halal", "none"]),
  allergy_details: z.string().max(200).optional(),
  digital_level: z.enum(["high", "medium", "low"]).default("high"),
});

const CreateCompanionsSchema = z.object({
  companions: z.array(CompanionSchema).min(1).max(20),
});
```

## Edge Function 패턴 (companions)
```typescript
// POST /api/profiles/companions — 배열 upsert
const { companions } = CreateCompanionsSchema.parse(await req.json());
const userId = (await supabase.auth.getUser()).data.user?.id;

const { data, error } = await supabase
  .from("companions")
  .upsert(
    companions.map(c => ({ ...c, user_id: userId })),
    { onConflict: "user_id,name" }
  )
  .select();

if (error) throw error;
```

## Edge Function 패턴 (companions 단건 수정)
```typescript
// PATCH /api/profiles/companions/:id
const companionId = url.pathname.split("/").at(-1);
const patch = CompanionSchema.partial().parse(await req.json());
const userId = (await supabase.auth.getUser()).data.user?.id;

const { data, error } = await supabase
  .from("companions")
  .update(patch)
  .eq("companion_id", companionId)
  .eq("user_id", userId)   // 본인 데이터만 수정
  .select()
  .single();

if (error) throw error;
```

## Edge Function 패턴 (groups)
```typescript
// POST /api/groups
const { name, color } = await req.json();
const userId = (await supabase.auth.getUser()).data.user?.id;

const { data: group } = await supabase
  .from("groups")
  .insert({ user_id: userId, name, color })
  .select()
  .single();

// POST /api/groups/:groupId/members
const { companionIds } = await req.json();
await supabase
  .from("group_members")
  .upsert(
    companionIds.map((id: string) => ({ group_id: groupId, companion_id: id })),
    { onConflict: "group_id,companion_id" }
  );
```

## React 컴포넌트 구조
```
src/features/profile/
├── ProfileSetup.tsx      # 온보딩 - 첫 등록 마법사
├── ProfileEdit.tsx       # 설정 화면 - 기존 프로필 수정
├── MemberCard.tsx        # 구성원 카드 (아이콘 + 제약 배지)
├── ConstraintForm.tsx    # 이동/식이 제약 선택 폼
├── GroupForm.tsx         # 그룹 생성/편집 폼
└── useProfiles.ts        # 프로필 조회/수정 훅
```

## useProfiles 훅 패턴
```typescript
export const useProfiles = () => {
  const [companions, setCompanions] = useState<Companion[]>([]);

  const saveCompanions = async (inputs: CreateCompanionInput[]) => {
    const res = await fetch("/api/companions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ companions: inputs }),
    });
    if (!res.ok) throw new Error(await res.text());
    const { companions } = await res.json();
    setCompanions(companions);
  };

  return { companions, saveCompanions };
};
```

## UX 원칙
- 온보딩: 단계별 마법사 (1단계: 구성원 수 → 2단계: 각 구성원 정보 → 3단계: 그룹 설정 → 4단계: 확인)
- 제약 없음도 명시: mobility_constraint/dietary_restriction 값으로 'none' 허용 (null 아님)
- 어르신 구성원은 digital_level: 'low' 기본 선택 유도 (도움말 텍스트 포함)
- 그룹 color: Tailwind 색상 팔레트에서 7자리 HEX 선택
