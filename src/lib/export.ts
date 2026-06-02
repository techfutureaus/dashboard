// Pure browser-side export utilities — no third-party deps.

type Row = Record<string, unknown>;

export function toCsv(rows: Row[]): string {
  if (rows.length === 0) return "";
  const headers = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));

  const escape = (v: unknown) => {
    if (v == null) return "";
    if (Array.isArray(v)) return escape(v.join("; "));
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(","));
  }
  return lines.join("\n");
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadCsv(filename: string, rows: Row[]) {
  const csv = toCsv(rows);
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  triggerDownload(blob, `${filename}.csv`);
}

/**
 * Find the SVG chart inside the given container and download it as PNG.
 * Falls back gracefully if no SVG present.
 */
export async function downloadChartPng(filename: string, container: HTMLElement) {
  const svgEl = container.querySelector("svg");
  if (!svgEl) throw new Error("No chart found to export.");

  // Clone so we can mutate without affecting the DOM.
  const cloned = svgEl.cloneNode(true) as SVGElement;
  cloned.setAttribute("xmlns", "http://www.w3.org/2000/svg");

  const bbox = svgEl.getBoundingClientRect();
  const w = Math.max(bbox.width, 100);
  const h = Math.max(bbox.height, 100);
  cloned.setAttribute("width", String(w));
  cloned.setAttribute("height", String(h));

  // White background rect (SVG default is transparent → looks bad on PNG).
  const ns = "http://www.w3.org/2000/svg";
  const bg = document.createElementNS(ns, "rect");
  bg.setAttribute("width", "100%");
  bg.setAttribute("height", "100%");
  bg.setAttribute("fill", "white");
  cloned.insertBefore(bg, cloned.firstChild);

  const svgStr = new XMLSerializer().serializeToString(cloned);
  const svgBlob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);

  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Failed to render SVG"));
      img.src = url;
    });

    const scale = window.devicePixelRatio > 1 ? 2 : 1;
    const canvas = document.createElement("canvas");
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get canvas context");
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);

    await new Promise<void>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error("Failed to make PNG blob"));
        triggerDownload(blob, `${filename}.png`);
        resolve();
      }, "image/png");
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
