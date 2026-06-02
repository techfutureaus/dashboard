"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
// import { useAuth } from "@/contexts/AuthContext";

const navItems = [
  {
    label: "Airtable",
    href: "/airtable",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M4 6h16M4 12h16M4 18h16"
        />
      </svg>
    ),
  },
  {
    label: "Mailchimp",
    href: "/mailchimp",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
        />
      </svg>
    ),
  },
  {
    label: "Google Analytics",
    href: "/ga4",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
        />
      </svg>
    ),
  },
];

export function Sidebar() {
  const pathname = usePathname();
  // const { user, signOut } = useAuth();

  return (
    <aside className="flex flex-col w-52 min-h-screen bg-white border-r border-gray-200">
      <div className="px-4 py-5">
        <Link href="/" className="text-lg font-bold text-gray-900">
          TFA Dashboard
        </Link>
      </div>

      <nav className="flex-1 px-3 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? "bg-violet-50 text-violet-700"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              }`}
            >
              {item.icon}
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Auth UI disabled — restore when auth is re-enabled
      <div className="px-4 py-4 border-t border-gray-200">
        {user?.email && <p className="text-xs text-gray-500 truncate mb-2">{user.email}</p>}
        <button onClick={signOut} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700">
          Sign out
        </button>
      </div>
      */}
    </aside>
  );
}
