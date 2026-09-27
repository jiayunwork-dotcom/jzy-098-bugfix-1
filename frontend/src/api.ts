import type { BuildResponse, SimResponse } from '@shared/types';

export interface Example {
  id: string;
  name: string;
  pattern: string;
  acceptSamples: string[];
  rejectSample: string;
  note: string;
}

async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

export async function fetchBuild(pattern: string): Promise<BuildResponse> {
  return postJSON<BuildResponse>('/api/build', { pattern });
}

export async function fetchSimulate(pattern: string, input: string): Promise<SimResponse> {
  return postJSON<SimResponse>('/api/simulate', { pattern, input });
}

export async function fetchExamples(): Promise<Example[]> {
  const res = await fetch('/api/examples');
  const json = (await res.json()) as { ok: boolean; examples: Example[] };
  return json.examples;
}
