"use client";

import { useMemo, useState } from "react";
import { useSchoolsRecords } from "@/hooks/useAirtableData";
import {
  Section,
  KpiCard,
  HBarChart,
  EmptyHint,
  Banner,
  Select,
  SegmentedControl,
  Toolbar,
} from "@/components/dashboard-bits";
import {
  countBy,
  countByMulti,
  distinctValues,
  sortAlpha,
  topN,
  type CountItem,
  type Row,
} from "@/lib/aggregation";

const ICSEA_ORDER = [
  "<701",
  "701-800",
  "801-900",
  "901-950",
  "951-1,000",
  "1,001-1,050",
  "1,051-1,100",
  "1,101-1,150",
  "1,151-1,200",
];

type SortMode = "count" | "alpha";

export default function SchoolsPage() {
  const { data, loading, error } = useSchoolsRecords();
  const [state, setState] = useState("");
  const [sector, setSector] = useState("");
  const [topNValue, setTopNValue] = useState<number>(10);
  const [sortMode, setSortMode] = useState<SortMode>("count");

  const records = data?.records ?? [];

  const stateOptions = useMemo(() => distinctValues(records, "State"), [records]);
  const sectorOptions = useMemo(() => distinctValues(records, "Sector"), [records]);

  const filtered = useMemo<Row[]>(() => {
    return records.filter((r) => {
      if (state && r["State"] !== state) return false;
      if (sector && r["Sector"] !== sector) return false;
      return true;
    });
  }, [records, state, sector]);

  const byState = useMaybeSorted(countBy(filtered, "State"), sortMode);
  const bySector = useMaybeSorted(countBy(filtered, "Sector"), sortMode);
  const byType = useMaybeSorted(countBy(filtered, "School Type"), sortMode);
  const byLocation = useMaybeSorted(countBy(filtered, "Location"), sortMode);
  const byActivation = useMemo(
    () => topN(countByMulti(filtered, "Activation Status"), topNValue),
    [filtered, topNValue]
  );
  const byProgramYear = useMemo(
    () => topN(countByMulti(filtered, "Programme Implemented"), topNValue),
    [filtered, topNValue]
  );
  const byIcseaTag = useMemo(() => {
    const icseaCounts = countBy(filtered, "ICSEA tag");
    return ICSEA_ORDER.filter((tag) => icseaCounts.some((c) => c.name === tag))
      .map((tag) => ({
        name: tag,
        count: icseaCounts.find((c) => c.name === tag)?.count ?? 0,
      }))
      .concat(icseaCounts.filter((c) => !ICSEA_ORDER.includes(c.name)));
  }, [filtered]);

  if (loading) return <div className="text-gray-500">Loading…</div>;
  if (error) return <Banner tone="error">{error}</Banner>;

  return (
    <>
      <Toolbar>
        <Select label="State" value={state} onChange={setState} options={stateOptions} />
        <Select label="Sector" value={sector} onChange={setSector} options={sectorOptions} />
        <Select
          label="Show top"
          value={String(topNValue)}
          onChange={(v) => setTopNValue(Number(v))}
          options={["5", "10", "20", "0"]}
          allLabel="10"
        />
        <SegmentedControl
          value={sortMode}
          onChange={setSortMode}
          options={[
            { value: "count", label: "By count" },
            { value: "alpha", label: "A-Z" },
          ]}
        />
        <span className="ml-auto text-xs text-gray-500">
          {filtered.length} of {records.length} schools
        </span>
      </Toolbar>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <KpiCard label="Schools (filtered)" value={filtered.length.toLocaleString()} />
        <KpiCard label="States" value={String(byState.length)} />
        <KpiCard label="School types" value={String(byType.length)} sub="present in filter" />
        <KpiCard label="ICSEA bands" value={String(byIcseaTag.length)} sub="present in filter" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section title="Schools by state" subtitle="From State field" exportData={byState} exportName="schools-by-state">
          {byState.length > 0 ? (
            <HBarChart data={byState} color="#3b82f6" nameWidth={80} />
          ) : (
            <EmptyHint>No state data.</EmptyHint>
          )}
        </Section>

        <Section title="Schools by sector" subtitle="Independent / Government / Catholic" exportData={bySector} exportName="schools-by-sector">
          {bySector.length > 0 ? (
            <HBarChart data={bySector} color="#22c55e" nameWidth={140} />
          ) : (
            <EmptyHint>No sector data.</EmptyHint>
          )}
        </Section>

        <Section title="Schools by type" subtitle="Primary / Secondary / Combined / Special" exportData={byType} exportName="schools-by-type">
          {byType.length > 0 ? (
            <HBarChart data={byType} color="#06b6d4" nameWidth={120} />
          ) : (
            <EmptyHint>No school type data.</EmptyHint>
          )}
        </Section>

        <Section title="Schools by location" subtitle="ASGS remoteness classification" exportData={byLocation} exportName="schools-by-location">
          {byLocation.length > 0 ? (
            <HBarChart data={byLocation} color="#f59e0b" nameWidth={140} />
          ) : (
            <EmptyHint>No location data.</EmptyHint>
          )}
        </Section>

        <Section
          title="ICSEA distribution"
          subtitle="Schools by ICSEA band (lower = more disadvantaged) — always natural order"
          exportData={byIcseaTag}
          exportName="schools-by-icsea"
        >
          {byIcseaTag.length > 0 ? (
            <HBarChart data={byIcseaTag} color="#8b5cf6" nameWidth={100} />
          ) : (
            <EmptyHint>No ICSEA data.</EmptyHint>
          )}
        </Section>

        <Section title="Activation status" subtitle={`Top ${topNValue || "all"} (multi-select)`} exportData={byActivation} exportName="schools-activation-status">
          {byActivation.length > 0 ? (
            <HBarChart data={byActivation} color="#ec4899" nameWidth={200} />
          ) : (
            <EmptyHint>No activation data.</EmptyHint>
          )}
        </Section>

        <Section
          title="Programs implemented"
          subtitle={`Top ${topNValue || "all"} entries (multi-select)`}
          exportData={byProgramYear}
          exportName="schools-programs-implemented"
        >
          {byProgramYear.length > 0 ? (
            <HBarChart data={byProgramYear} color="#10b981" nameWidth={180} />
          ) : (
            <EmptyHint>No program data.</EmptyHint>
          )}
        </Section>
      </div>
    </>
  );
}

function useMaybeSorted(items: CountItem[], mode: SortMode): CountItem[] {
  return useMemo(() => (mode === "alpha" ? sortAlpha(items) : items), [items, mode]);
}
