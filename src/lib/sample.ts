/**
 * Loads the one perfect sample incident (§9) from data/sample-incident.
 * Server-side only (reads the filesystem). The screenshot is returned as a
 * base64 data URI — the only image format Cerebras accepts.
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';

const SAMPLE_DIR = path.join(process.cwd(), 'data', 'sample-incident');

export interface IncidentInput {
  logs: string;
  complaint: string;
  /** Screenshot as a base64 data URI, or undefined if absent. */
  screenshotDataUri?: string;
}

export async function loadSampleIncident(): Promise<IncidentInput> {
  const [logs, complaint, png] = await Promise.all([
    fs.readFile(path.join(SAMPLE_DIR, 'logs.txt'), 'utf8'),
    fs.readFile(path.join(SAMPLE_DIR, 'complaint.txt'), 'utf8'),
    fs.readFile(path.join(SAMPLE_DIR, 'screenshot.png')),
  ]);
  return {
    logs,
    complaint,
    screenshotDataUri: `data:image/png;base64,${png.toString('base64')}`,
  };
}
