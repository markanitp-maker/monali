import { BottomNav } from "./BottomNav";

interface AppLayoutProps {
  children: React.ReactNode;
}

export const AppLayout = ({ children }: AppLayoutProps) => (
  <div className="min-h-screen bg-gray-50">
    <main className="pb-20 max-w-3xl mx-auto">
      {children}
    </main>
    <BottomNav />
  </div>
);
