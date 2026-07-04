import { CheckCircle2, Clipboard, Download, FileAudio, FileVideo, Loader2, XCircle } from 'lucide-react';
import { transcriptDownloadUrl } from '../api/client';
import type { TranscriptionJob } from '../api/types';

interface JobRowProps {
  job: TranscriptionJob;
}

export function JobRow({ job }: JobRowProps) {
  const progress = progressValue(job);
  const done = job.status === 'completed';
  const failed = job.status === 'failed';

  const copyText = async () => {
    if (!job.transcript) return;
    await navigator.clipboard.writeText(job.transcript);
  };

  return (
    <article className={`job-row status-${job.status}`}>
      <div className="job-main">
        <div className="job-icon" aria-hidden="true">
          {job.source_kind === 'video' ? <FileVideo size={20} /> : <FileAudio size={20} />}
        </div>
        <div className="job-content">
          <div className="job-heading">
            <h2>{job.name}</h2>
            <StatusBadge job={job} />
          </div>
          <div className="job-meta">
            <span>{formatFileSize(job.size)}</span>
            <span>{job.source_kind}</span>
            <span>
              {job.generate_mp3 ? 'MP3' : ''}
              {job.generate_mp3 && job.generate_txt ? ' + ' : ''}
              {job.generate_txt ? 'TXT' : ''}
            </span>
            {job.chunks_count > 0 && (
              <span>
                {job.chunks_completed}/{job.chunks_count} chunks
              </span>
            )}
          </div>
          {!done && !failed && (
            <div className="progress-track" aria-label="Processing progress">
              <div className="progress-bar" style={{ width: progress === null ? '35%' : `${progress}%` }} />
            </div>
          )}
          {failed && <p className="job-error">{job.error ?? 'Transcription failed'}</p>}
        </div>
      </div>

      {done && (
        <div className="result-panel">
          <div className="output-paths">
            {job.audio_path && <span>MP3: {job.audio_path}</span>}
            {job.transcript_path && <span>TXT: {job.transcript_path}</span>}
          </div>
          {job.transcript && <textarea value={job.transcript} readOnly />}
          <div className="result-actions">
            <button type="button" onClick={copyText} disabled={!job.transcript} title="Copy text">
              <Clipboard size={16} />
              <span>Copy</span>
            </button>
            {job.transcript_path && (
              <a href={transcriptDownloadUrl(job.id)} title="Download transcript">
                <Download size={16} />
                <span>Download TXT</span>
              </a>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

function StatusBadge({ job }: { job: TranscriptionJob }) {
  if (job.status === 'completed') {
    return (
      <span className="status-badge ok">
        <CheckCircle2 size={14} />
        Done
      </span>
    );
  }
  if (job.status === 'failed') {
    return (
      <span className="status-badge fail">
        <XCircle size={14} />
        Failed
      </span>
    );
  }
  return (
    <span className="status-badge active">
      <Loader2 size={14} />
      {job.status === 'queued' ? 'Queued' : job.generate_txt ? 'Transcribing' : 'Processing'}
    </span>
  );
}

function progressValue(job: TranscriptionJob): number | null {
  if (job.chunks_count <= 0) return null;
  return Math.min(100, Math.round((job.chunks_completed / job.chunks_count) * 100));
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
