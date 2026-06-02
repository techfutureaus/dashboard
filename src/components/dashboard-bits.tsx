"use client";

import { useRef, useState, useEffect } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { downloadCsv, downloadChartPng } from "@/lib/export";

export function Section({
  title,
  subtitle,
  children,
  exportData,
  exportName,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  /** Underlying rows for CSV export. Omit to hide CSV option. */
  exportData?: Record<string, unknown>[];
  /** File name base (no extension). Required to enable export. */
  exportName?: string;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const canExport = !!exportName;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
        </div>
        {canExport && (
          <ExportMenu
            onCsv={
              exportData && exportData.length > 0
                ? () => downloadCsv(exportName!, exportData)
                : undefined
            }
            onPng={async () => {
              if (bodyRef.current) {
                try {
                  await downloadChartPng(exportName!, bodyRef.current);
                } catch (e) {
                  console.error("PNG export failed:", e);
                }
              }
            }}
          />
        )}
      </div>
      <div ref={bodyRef}>{children}</div>
    </div>
  );
}

function ExportMenu({ onCsv, onPng }: { onCsv?: () => void; onPng: () => void }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 focus:outline-none"
        aria-label="Export chart"
        title="Export"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
          />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-30 min-w-[160px]">
          {onCsv && (
            <button
              onClick={() => {
                onCsv();
                setOpen(false);
              }}
              className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
            >
              Download CSV
            </button>
          )}
          <button
            onClick={() => {
              onPng();
              setOpen(false);
            }}
            className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
          >
            Download PNG
          </button>
        </div>
      )}
    </div>
  );
}

export function KpiCard({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "neutral" | "positive" | "negative";
}) {
  const toneClass =
    tone === "positive" ? "text-green-600" : tone === "negative" ? "text-red-600" : "text-gray-900";
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${toneClass}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

export function HBarChart({
  data,
  color,
  valueKey = "count",
  nameWidth = 180,
}: {
  data: { name: string; [k: string]: string | number }[];
  color: string;
  valueKey?: string;
  nameWidth?: number;
}) {
  return (
    <div style={{ height: Math.max(180, data.length * 32) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 11 }} />
          <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={nameWidth} />
          <Tooltip />
          <Bar dataKey={valueKey} fill={color} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function EmptyHint({ children }: { children: React.ReactNode }) {
  return <div className="text-sm text-gray-400 py-6 text-center">{children}</div>;
}

export function Banner({
  tone,
  children,
}: {
  tone: "error" | "warn";
  children: React.ReactNode;
}) {
  const cls =
    tone === "error"
      ? "bg-red-50 border-red-200 text-red-700"
      : "bg-yellow-50 border-yellow-200 text-yellow-800";
  return <div className={`rounded-lg border p-4 text-sm mb-6 ${cls}`}>{children}</div>;
}

export function Select({
  label,
  value,
  onChange,
  options,
  allLabel = "All",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  allLabel?: string;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-gray-600">
      <span>{label}</span>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="appearance-none pl-3 pr-8 py-1.5 bg-white border border-gray-200 rounded-md text-sm text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-violet-500"
        >
          <option value="">{allLabel}</option>
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
        <svg
          className="w-3 h-3 text-gray-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>
    </label>
  );
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="inline-flex p-0.5 bg-gray-100 rounded-md">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
              active ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function Toolbar({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 mb-6 pb-4 border-b border-gray-100">
      {children}
    </div>
  );
}
