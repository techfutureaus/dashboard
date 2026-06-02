"use client";

import { useState, useRef, useEffect } from "react";
import {
  format,
  subMonths,
  addMonths,
  isSameDay,
  isWithinInterval,
  eachDayOfInterval,
  startOfMonth,
  endOfMonth,
} from "date-fns";
import { PRESETS, matchesPreset, type DateRange, type DatePreset } from "@/lib/date-presets";

interface DateRangeControlProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
}

export function DateRangeControl({ value, onChange }: DateRangeControlProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const label = describeRange(value);

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2"
      >
        <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
        {label}
        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <Popover
          value={value}
          onApply={(r) => {
            onChange(r);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function describeRange(range: DateRange): string {
  if (!range.start && !range.end) return "All time";
  const matched = PRESETS.find((p) => matchesPreset(range, p));
  if (matched) return matched.label;
  if (range.start && range.end) {
    return `${format(range.start, "MMM d, yyyy")} – ${format(range.end, "MMM d, yyyy")}`;
  }
  return "Custom";
}

function Popover({
  value,
  onApply,
  onClose,
}: {
  value: DateRange;
  onApply: (range: DateRange) => void;
  onClose: () => void;
}) {
  const [tempRange, setTempRange] = useState<DateRange>(value);
  const [leftMonth, setLeftMonth] = useState(() => {
    const anchor = value.end ?? value.start ?? new Date();
    return subMonths(anchor, 1);
  });
  const [selectingEnd, setSelectingEnd] = useState(false);
  const [hoverDate, setHoverDate] = useState<Date | null>(null);

  const handleDateClick = (date: Date) => {
    if (!selectingEnd || !tempRange.start) {
      setTempRange({ start: date, end: null });
      setSelectingEnd(true);
    } else {
      const start = tempRange.start < date ? tempRange.start : date;
      const end = tempRange.start < date ? date : tempRange.start;
      setTempRange({ start, end });
      setSelectingEnd(false);
    }
  };

  const handlePresetClick = (preset: DatePreset) => {
    const r = preset.range();
    setTempRange(r);
    setSelectingEnd(false);
    setHoverDate(null);
    // Snap calendar view to the preset's range so the user sees it.
    if (r.end) setLeftMonth(subMonths(r.end, 1));
    else if (r.start) setLeftMonth(subMonths(r.start, 1));
  };

  const rightMonth = addMonths(leftMonth, 1);
  const canApply =
    (!tempRange.start && !tempRange.end) || (tempRange.start && tempRange.end);

  return (
    <div className="absolute top-full right-0 mt-2 bg-white rounded-xl shadow-xl border border-gray-200 z-50 flex w-[760px]">
      {/* Presets column */}
      <div className="w-44 border-r border-gray-100 py-2">
        {PRESETS.map((preset) => {
          const active = matchesPreset(tempRange, preset);
          return (
            <button
              key={preset.id}
              onClick={() => handlePresetClick(preset)}
              className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                active
                  ? "bg-violet-50 text-violet-700 font-medium"
                  : "text-gray-700 hover:bg-gray-50"
              }`}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      {/* Calendar column */}
      <div className="flex-1 p-4">
        <div className="flex items-center gap-3 mb-3 text-xs">
          <span className="text-gray-500">Start</span>
          <div className="px-2.5 py-1 border border-gray-200 rounded-md bg-gray-50 font-mono text-gray-700">
            {tempRange.start ? format(tempRange.start, "dd / MM / yyyy") : "-- / -- / ----"}
          </div>
          <span className="text-gray-500">End</span>
          <div className="px-2.5 py-1 border border-gray-200 rounded-md bg-gray-50 font-mono text-gray-700">
            {tempRange.end ? format(tempRange.end, "dd / MM / yyyy") : "-- / -- / ----"}
          </div>
        </div>

        <div className="flex items-start gap-3">
          <button
            onClick={() => setLeftMonth(subMonths(leftMonth, 1))}
            className="p-1 hover:bg-gray-100 rounded mt-0.5"
          >
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          <Calendar
            month={leftMonth}
            selectedRange={tempRange}
            onDateClick={handleDateClick}
            hoverDate={hoverDate}
            onDateHover={setHoverDate}
          />
          <Calendar
            month={rightMonth}
            selectedRange={tempRange}
            onDateClick={handleDateClick}
            hoverDate={hoverDate}
            onDateHover={setHoverDate}
          />

          <button
            onClick={() => setLeftMonth(addMonths(leftMonth, 1))}
            className="p-1 hover:bg-gray-100 rounded mt-0.5"
          >
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        <div className="flex justify-end gap-2 mt-3 pt-3 border-t border-gray-100">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={() => canApply && onApply(tempRange)}
            disabled={!canApply}
            className="px-4 py-1.5 text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

function Calendar({
  month,
  selectedRange,
  onDateClick,
  hoverDate,
  onDateHover,
}: {
  month: Date;
  selectedRange: DateRange;
  onDateClick: (date: Date) => void;
  hoverDate: Date | null;
  onDateHover: (date: Date | null) => void;
}) {
  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const startDayOfWeek = monthStart.getDay();
  const adjustedStartDay = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1;

  const isInRange = (date: Date) => {
    if (!selectedRange.start) return false;
    const end = selectedRange.end || hoverDate;
    if (!end) return false;
    const rangeStart = selectedRange.start < end ? selectedRange.start : end;
    const rangeEnd = selectedRange.start < end ? end : selectedRange.start;
    return isWithinInterval(date, { start: rangeStart, end: rangeEnd });
  };
  const isRangeStart = (date: Date) =>
    selectedRange.start ? isSameDay(date, selectedRange.start) : false;
  const isRangeEnd = (date: Date) =>
    selectedRange.end ? isSameDay(date, selectedRange.end) : false;

  return (
    <div className="w-[240px]">
      <div className="text-center font-medium text-gray-900 mb-2 text-sm">
        {format(month, "MMMM yyyy")}
      </div>
      <div className="grid grid-cols-7 gap-0 text-center text-xs text-gray-500 mb-1">
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((day) => (
          <div key={day} className="py-1">{day}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0">
        {Array.from({ length: adjustedStartDay }).map((_, i) => (
          <div key={`empty-${i}`} className="h-8" />
        ))}
        {days.map((day) => {
          const inRange = isInRange(day);
          const isStart = isRangeStart(day);
          const isEnd = isRangeEnd(day);
          const isSelected = isStart || isEnd;
          return (
            <div
              key={day.toISOString()}
              className={`relative h-8 flex items-center justify-center ${
                inRange && !isSelected ? "bg-violet-100" : ""
              } ${isStart && selectedRange.end ? "rounded-l-full bg-violet-100" : ""} ${
                isEnd ? "rounded-r-full bg-violet-100" : ""
              }`}
            >
              <button
                onClick={() => onDateClick(day)}
                onMouseEnter={() => onDateHover(day)}
                onMouseLeave={() => onDateHover(null)}
                className={`w-7 h-7 rounded-full text-xs transition-colors focus:outline-none ${
                  isSelected
                    ? "bg-violet-600 text-white font-medium"
                    : inRange
                    ? "text-violet-700"
                    : "text-gray-700 hover:bg-gray-100"
                }`}
              >
                {format(day, "d")}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
