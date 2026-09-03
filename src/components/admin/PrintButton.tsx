"use client";

import { btn } from "@/components/ui/controls";

/** The one action that needs the browser and nothing else. */
export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={`${btn()} no-print`}>
      {label}
    </button>
  );
}
