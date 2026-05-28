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
import { OnboardingPage } from "@/features/onboarding/OnboardingPage";
import { ProtectedRoute } from "@/components/ProtectedRoute";

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/onboarding" replace />} />
      <Route path="/onboarding" element={<OnboardingPage />} />

      {/* 플래너 라우트 (인증 필요) */}
      <Route path="/planner" element={<ProtectedRoute><PlannerHome /></ProtectedRoute>} />
      <Route path="/planner/new" element={<ProtectedRoute><GeneratorForm /></ProtectedRoute>} />
      <Route path="/planner/progress/:taskId" element={<ProtectedRoute><AiProgressView /></ProtectedRoute>} />
      <Route path="/planner/:planId" element={<ProtectedRoute><CourseComparison /></ProtectedRoute>} />

      {/* 공유 페이지 (비회원 접근 가능) */}
      <Route path="/share/:token" element={<SharePage />} />

      <Route path="/itinerary/:planId" element={<ProtectedRoute><ItineraryView /></ProtectedRoute>} />

      {/* 아카이브 라우트 (인증 필요) */}
      <Route path="/archive" element={<ProtectedRoute><ArchiveList /></ProtectedRoute>} />
      <Route path="/archive/:planId/feedback" element={<ProtectedRoute><ArchiveForm /></ProtectedRoute>} />
      <Route path="/archive/:id" element={<ProtectedRoute><ArchiveDetail /></ProtectedRoute>} />
    </Routes>
  );
}

export default App;
