import axios from 'axios';
import type { TranscriptionJob } from './types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api';
const REQUEST_TIMEOUT_MS = 30 * 60_000;

const http = axios.create({
  baseURL: API_BASE_URL,
  timeout: REQUEST_TIMEOUT_MS,
});

export async function fetchTranscriptions(): Promise<TranscriptionJob[]> {
  const { data } = await http.get<TranscriptionJob[]>('/transcriptions');
  return data;
}

export interface TranscriptionOptions {
  generate_mp3: boolean;
  generate_txt: boolean;
  openai_api_key?: string;
}

function openAiHeaders(openaiApiKey: string | undefined): Record<string, string> {
  const apiKey = openaiApiKey?.trim();
  return apiKey ? { 'X-OpenAI-API-Key': apiKey } : {};
}

export async function createTranscriptionsFromPaths(
  paths: string[],
  options: TranscriptionOptions,
): Promise<TranscriptionJob[]> {
  const { data } = await http.post<TranscriptionJob[]>(
    '/transcriptions/paths',
    {
      paths,
      generate_mp3: options.generate_mp3,
      generate_txt: options.generate_txt,
    },
    {
      headers: openAiHeaders(options.openai_api_key),
    },
  );
  return data;
}

export async function uploadTranscriptionFile(
  file: File,
  options: TranscriptionOptions,
): Promise<TranscriptionJob> {
  const { data } = await http.post<TranscriptionJob>('/transcriptions/upload', file, {
    params: {
      generate_mp3: options.generate_mp3,
      generate_txt: options.generate_txt,
    },
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'X-Filename': encodeURIComponent(file.name),
      ...openAiHeaders(options.openai_api_key),
    },
  });
  return data;
}

export function jobEventsUrl(jobId: string): string {
  return `${API_BASE_URL}/transcriptions/${jobId}/events`;
}

export function transcriptDownloadUrl(jobId: string): string {
  return `${API_BASE_URL}/transcriptions/${jobId}/download`;
}
