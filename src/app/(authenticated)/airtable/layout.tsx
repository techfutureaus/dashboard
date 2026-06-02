"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/airtable/schools", label: "Schools & reach" },
  { href: "/airtable/people", label: "People pipeline" },
  { href: "/airtable/impact", label: "Impact" },
  { href: "/airtable/teacher-training", label: "Teacher Training" },
  { href: "/airtable/careers-days", label: "Careers Days" },
];

export default function AirtableLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="p-8 max-w-7xl">
      <div className="mb-2">
        <h1 className="text-2xl font-bold text-gray-900">Airtable</h1>
        <p className="text-sm text-gray-500">TFA operations data</p>
      </div>

      <nav className="border-b border-gray-200 mb-6">
        <div className="flex gap-1 -mb-px">
          {TABS.map((t) => {
            const active = pathname === t.href || pathname.startsWith(t.href + "/");
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  active
                    ? "border-violet-600 text-violet-700"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </div>
      </nav>

      {children}
    </div>
  );
}
