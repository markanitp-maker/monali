import { Routes, Route, Navigate } from "react-router-dom";

import { PlannerHome } from "@/features/planner/PlannerHome";
import { GeneratorForm } from "@/features/planner/GeneratorForm";
import { AiProgressView } from "@/features/planner/AiProgressView";
import { CourseComparison } from "@/features/planner/CourseComparison";
import { ItineraryView } from "@/features/itinerary/ItineraryView";
import { SharePage } from "@/features/share/SharePage";
import { ArchiveList } from "@/features/archive/ArchiveList";
import { ArchiveForm } from "@/features/archive/ArchiveForm";
import { ArchiveDetail } from "@/features/archive/ArchiveDetail";

// 각 기능 모듈은 구현 후 import 추가
// import { ProfileSetup } from "@/features/profile/ProfileSetup";

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/onboarding" replace />} />
      <Route path="/onboarding" element={<div>온보딩 준비 중</div>} />

      {/* 플래너 라우트 */}
      <Route path="/planner" element={<PlannerHome />} />
      <Route path="/planner/new" element={<GeneratorForm />} />
      <Route path="/planner/progress/:taskId" element={<AiProgressView />} />
      <Route path="/planner/:planId" element={<CourseComparison />} />

      <Route path="/share/:token" element={<SharePage />} />
      <Route path="/itinerary/:planId" element={<ItineraryView />} />
      {/* 아카이브 라우트 */}
      <Route path="/archive" element={<ArchiveList />} />
      <Route path="/archive/:planId/feedback" element={<ArchiveForm />} />
      <Route path="/archive/:id" element={<ArchiveDetail />} />
    </Routes>
  );
}

export default App;
