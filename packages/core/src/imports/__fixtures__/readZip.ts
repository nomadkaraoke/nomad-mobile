// Test helper: reads a whole synthetic export through the streaming reader (kept apart from buildExport.ts,
// which must import only fflate).
import { ExportAggregator } from '../aggregator';
import type { ExportSummary } from '../types';

/** Reads a whole zip through the streaming reader, `chunk` bytes at a time. */
export function readZip(zip: Uint8Array, chunk = zip.length): ExportSummary | null {
  const agg = new ExportAggregator();
  const reader = agg.createReader();
  for (let off = 0; off < zip.length; off += chunk) {
    const end = Math.min(zip.length, off + chunk);
    reader.push(zip.subarray(off, end), end === zip.length);
  }
  if (zip.length === 0) reader.push(new Uint8Array(0), true);
  return agg.summary();
}

