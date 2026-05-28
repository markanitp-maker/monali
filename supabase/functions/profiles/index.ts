/**
 * POST /api/profiles
 *
 * Monali 가족 구성원 프로필 배열 upsert Edge Function.
 *
 * - 인증: Supabase Auth Bearer 토큰 필수
 * - 입력: { members: NewMemberProfile[] }
 * - 동작: (owner_user_id, display_name) 기준 upsert
 * - 응답: { profiles, updatedAt, recommendSimpleView }
 */

// @ts-ignore Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
// @ts-ignore Deno runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// @ts-ignore Deno runtime
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ─── Zod 스키마 ──────────────────────────────────────────────────────────────
const MobilityEnum = z.enum(["wheelchair", "stroller", "none"]);
const DietaryEnum = z.enum(["allergy", "vegan", "vegetarian", "halal", "none"]);
const DigitalLiteracyEnum = z.enum(["high", "medium", "low"]);

const MemberSchema = z.object({
  name: z.string().min(1, "이름은 필수입니다").max(50),
  mobilityConstraints: z.array(MobilityEnum).default([]),
  dietaryConstraints: z.array(DietaryEnum).default([]),
  allergyDetails: z.string().max(200).optional(),
  digitalLiteracy: DigitalLiteracyEnum.default("high"),
});

const CreateProfilesSchema = z.object({
  members: z.array(MemberSchema).min(1).max(10),
});

// ─── DB row 매핑 ─────────────────────────────────────────────────────────────
interface MemberProfileRow {
  id: string;
  owner_user_id: string;
  display_name: string;
  mobility_type: string[] | null;
  dietary_type: string[] | null;
  digital_literacy: "low" | "medium" | "high";
  constraint_details: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

const rowToProfile = (row: MemberProfileRow) => ({
  id: row.id,
  userId: row.owner_user_id,
  name: row.display_name,
  mobilityConstraints: (row.mobility_type ?? []) as Array<
    "wheelchair" | "stroller" | "none"
  >,
  dietaryConstraints: (row.dietary_type ?? []) as Array<
    "allergy" | "vegan" | "vegetarian" | "halal" | "none"
  >,
  allergyDetails:
    (row.constraint_details as { allergyDetails?: string } | null)
      ?.allergyDetails ?? undefined,
  digitalLiteracy: row.digital_literacy,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method Not Allowed" }, 405);
  }

  try {
    // @ts-ignore Deno global
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    // @ts-ignore Deno global
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Unauthorized: missing Authorization header" }, 401);
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return json({ error: "Unauthorized" }, 401);
    }

    // 입력 파싱 & 검증
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const parsed = CreateProfilesSchema.safeParse(rawBody);
    if (!parsed.success) {
      return json(
        { error: "ValidationError", issues: parsed.error.issues },
        400,
      );
    }

    // DB 형태로 변환
    const rows = parsed.data.members.map((m) => ({
      owner_user_id: user.id,
      display_name: m.name,
      mobility_type: m.mobilityConstraints,
      dietary_type: m.dietaryConstraints,
      digital_literacy: m.digitalLiteracy,
      constraint_details: m.allergyDetails
        ? { allergyDetails: m.allergyDetails }
        : {},
    }));

    const { data, error } = await supabase
      .from("member_profiles")
      .upsert(rows, { onConflict: "owner_user_id,display_name" })
      .select();

    if (error) {
      // 23505 unique violation → 409
      if ((error as { code?: string }).code === "23505") {
        return json({ error: "Conflict", message: error.message }, 409);
      }
      return json({ error: "DBError", message: error.message }, 500);
    }

    const profiles = (data as MemberProfileRow[]).map(rowToProfile);
    const recommendSimpleView = profiles.some(
      (p) => p.digitalLiteracy === "low",
    );

    return json({
      profiles,
      updatedAt: new Date().toISOString(),
      recommendSimpleView,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return json({ error: "InternalServerError", message }, 500);
  }
});
