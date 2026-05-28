-- ======================================================
-- 002_rls_policies.sql
-- 모두의 나들이 (Monali) — RLS 정책
-- 원칙: 본인 데이터 격리 + share_token 기반 공개 접근
-- ======================================================

-- profiles: 본인만 접근
CREATE POLICY "profiles_owner" ON public.profiles
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- companions: 본인만 접근
CREATE POLICY "companions_owner" ON public.companions
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- groups: 본인만 접근
CREATE POLICY "groups_owner" ON public.groups
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- group_members: 그룹 소유자만 접근
CREATE POLICY "group_members_owner" ON public.group_members
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.groups g
      WHERE g.group_id = group_members.group_id AND g.user_id = auth.uid()
    )
  );

-- plans: 활성 요금제 공개 읽기
CREATE POLICY "plans_public_read" ON public.plans
  FOR SELECT TO anon, authenticated
  USING (is_active = true);

-- subscriptions: 본인만 접근
CREATE POLICY "subscriptions_owner" ON public.subscriptions
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- credit_transactions: 본인만 접근
CREATE POLICY "credits_owner" ON public.credit_transactions
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- trips: 본인 접근 + share_token 공개 읽기
CREATE POLICY "trips_owner" ON public.trips
  FOR ALL TO authenticated
  USING (auth.uid() = creator_id) WITH CHECK (auth.uid() = creator_id);

CREATE POLICY "trips_share_read" ON public.trips
  FOR SELECT TO anon, authenticated
  USING (
    share_token IS NOT NULL
    AND (consensus_deadline IS NULL OR consensus_deadline > NOW())
  );

-- ai_tasks: 호스트 접근 + share 읽기
CREATE POLICY "ai_tasks_owner" ON public.ai_tasks
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.plan_id = ai_tasks.plan_id AND t.creator_id = auth.uid()
    )
  );

CREATE POLICY "ai_tasks_share_read" ON public.ai_tasks
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.plan_id = ai_tasks.plan_id
        AND t.share_token IS NOT NULL
        AND (t.consensus_deadline IS NULL OR t.consensus_deadline > NOW())
    )
  );

-- plan_members: 호스트 전체 + 비회원 삽입/조회
CREATE POLICY "plan_members_host" ON public.plan_members
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.plan_id = plan_members.plan_id AND t.creator_id = auth.uid()
    )
  );

CREATE POLICY "plan_members_guest_insert" ON public.plan_members
  FOR INSERT TO anon
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.plan_id = plan_members.plan_id
        AND t.share_token IS NOT NULL
        AND (t.consensus_deadline IS NULL OR t.consensus_deadline > NOW())
    )
  );

CREATE POLICY "plan_members_guest_read" ON public.plan_members
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.plan_id = plan_members.plan_id AND t.share_token IS NOT NULL
    )
  );

-- places: 공개 읽기 (마스터 데이터), 수정은 서비스 역할만
CREATE POLICY "places_public_read" ON public.places
  FOR SELECT TO anon, authenticated
  USING (true);

-- course_options: 호스트 접근 + share 읽기
CREATE POLICY "course_options_owner" ON public.course_options
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.plan_id = course_options.plan_id AND t.creator_id = auth.uid()
    )
  );

CREATE POLICY "course_options_share_read" ON public.course_options
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.plan_id = course_options.plan_id AND t.share_token IS NOT NULL
    )
  );

-- itinerary_items: course_options 접근 제어와 동일
CREATE POLICY "items_owner" ON public.itinerary_items
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.course_options co
      JOIN public.trips t ON t.plan_id = co.plan_id
      WHERE co.course_id = itinerary_items.course_id AND t.creator_id = auth.uid()
    )
  );

CREATE POLICY "items_share_read" ON public.itinerary_items
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.course_options co
      JOIN public.trips t ON t.plan_id = co.plan_id
      WHERE co.course_id = itinerary_items.course_id AND t.share_token IS NOT NULL
    )
  );

-- votes: 호스트 읽기 + share 투표 (삽입/수정)
CREATE POLICY "votes_host_read" ON public.votes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.plan_members pm
      JOIN public.trips t ON t.plan_id = pm.plan_id
      WHERE pm.member_id = votes.member_id AND t.creator_id = auth.uid()
    )
  );

CREATE POLICY "votes_share_insert" ON public.votes
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.plan_members pm
      JOIN public.trips t ON t.plan_id = pm.plan_id
      WHERE pm.member_id = votes.member_id
        AND t.share_token IS NOT NULL
        AND (t.consensus_deadline IS NULL OR t.consensus_deadline > NOW())
    )
  );

CREATE POLICY "votes_share_update" ON public.votes
  FOR UPDATE TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.plan_members pm
      JOIN public.trips t ON t.plan_id = pm.plan_id
      WHERE pm.member_id = votes.member_id AND t.share_token IS NOT NULL
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.plan_members pm
      JOIN public.trips t ON t.plan_id = pm.plan_id
      WHERE pm.member_id = votes.member_id
        AND t.share_token IS NOT NULL
        AND (t.consensus_deadline IS NULL OR t.consensus_deadline > NOW())
    )
  );

-- outing_archives: 본인(trip 소유자)만 접근
CREATE POLICY "archives_owner" ON public.outing_archives
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.plan_id = outing_archives.plan_id AND t.creator_id = auth.uid()
    )
  );
