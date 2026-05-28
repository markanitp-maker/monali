import { NavLink } from "react-router-dom";
import { Archive, MapIcon, User } from "lucide-react";

const ITEMS = [
  { to: "/planner", label: "플래너", Icon: MapIcon },
  { to: "/archive", label: "아카이브", Icon: Archive },
  { to: "/profile", label: "프로필", Icon: User },
] as const;

export const BottomNav = () => (
  <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 safe-area-pb">
    <ul className="flex max-w-3xl mx-auto">
      {ITEMS.map(({ to, label, Icon }) => (
        <li key={to} className="flex-1">
          <NavLink
            to={to}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-1 py-2.5 text-xs font-medium transition-colors ${
                isActive ? "text-blue-600" : "text-gray-500 hover:text-gray-800"
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={22} strokeWidth={isActive ? 2.5 : 1.8} />
                <span>{label}</span>
              </>
            )}
          </NavLink>
        </li>
      ))}
    </ul>
  </nav>
);
