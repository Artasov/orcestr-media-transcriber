export type JobStatus = 'queued' | 'processing' | 'transcribing' | 'completed' | 'failed';

export interface TranscriptionJob {
  id: string;
  name: string;
  source_path: string;
  source_kind: string;
  size: number;
  status: JobStatus;
  created_at: string;
  updated_at: string;
  chunks_completed: number;
  chunks_count: number;
  generate_mp3: boolean;
  generate_txt: boolean;
  transcript: string;
  transcript_path: string | null;
  audio_path: string | null;
  error: string | null;
}

export interface JobEventPayload {
  event: string;
  job: TranscriptionJob;
  chunk_index?: number;
  chunks_completed?: number;
  chunks_count?: number;
}
