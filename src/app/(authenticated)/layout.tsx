"use client";

import { Sidebar } from "@/components/Sidebar";

export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      {/* No overflow-auto here: the window is the scroll container, and an
          overflow context on main would break sticky descendants (the report
          pages' sticky banner). min-w-0 keeps wide tables shrinkable. */}
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
