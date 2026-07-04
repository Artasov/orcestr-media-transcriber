import { AlertCircle, FileAudio, RefreshCcw, Trash2, X } from 'lucide-react';
import type { DragEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { fetchTranscriptions, jobEventsUrl, uploadTranscriptionFile } from './api/client';
import type { JobEventPayload, TranscriptionJob } from './api/types';
import { FileDropZone } from './components/FileDropZone';
import { JobRow } from './components/JobRow';

const OPENAI_API_KEY_STORAGE_KEY = 'orcestr-media-transcriber.openaiApiKey';

export function App() {
  const [jobs, setJobs] = useState<TranscriptionJob[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [generateMp3, setGenerateMp3] = useState(true);
  const [generateTxt, setGenerateTxt] = useState(true);
  const [openaiApiKey, setOpenaiApiKey] = useState(() => storedOpenaiApiKey());
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dragDepth = useRef(0);
  const eventSources = useRef<Map<string, EventSource>>(new Map());

  const hasPendingFiles = pendingFiles.length > 0;
  const hasJobs = jobs.length > 0;
  const hasFiles = hasPendingFiles || hasJobs;
  const canStart = hasPendingFiles && !uploading;

  const mergeJob = (job: TranscriptionJob) => {
    setJobs((current) => {
      const exists = current.some((item) => item.id === job.id);
      const next = exists ? current.map((item) => (item.id === job.id ? job : item)) : [job, ...current];
      return next.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    });
  };

  const attachEvents = (job: TranscriptionJob) => {
    if (eventSources.current.has(job.id) || ['completed', 'failed'].includes(job.status)) return;
    const source = new EventSource(jobEventsUrl(job.id));
    eventSources.current.set(job.id, source);
    const onMessage = (event: Event) => {
      const messageEvent = event as MessageEvent<string>;
      const payload = JSON.parse(messageEvent.data) as JobEventPayload;
      mergeJob(payload.job);
      if (['completed', 'failed'].includes(payload.job.status)) {
        source.close();
        eventSources.current.delete(payload.job.id);
      }
    };
    source.addEventListener('job.snapshot', onMessage);
    source.addEventListener('job.status', onMessage);
    source.addEventListener('job.chunk_done', onMessage);
    source.addEventListener('job.completed', onMessage);
    source.addEventListener('job.failed', onMessage);
    source.onerror = () => {
      source.close();
      eventSources.current.delete(job.id);
    };
  };

  const loadJobs = async () => {
    setError(null);
    try {
      const loaded = await fetchTranscriptions();
      setJobs(loaded);
      loaded.forEach(attachEvents);
    } catch (loadError) {
      setError(errorMessage(loadError));
    }
  };

  useEffect(() => {
    void loadJobs();
    return () => {
      eventSources.current.forEach((source) => source.close());
      eventSources.current.clear();
    };
  }, []);

  useEffect(() => {
    try {
      const apiKey = openaiApiKey.trim();
      if (apiKey) {
        localStorage.setItem(OPENAI_API_KEY_STORAGE_KEY, apiKey);
        return;
      }
      localStorage.removeItem(OPENAI_API_KEY_STORAGE_KEY);
    } catch {
      return;
    }
  }, [openaiApiKey]);

  const addFiles = (files: File[]) => {
    if (files.length === 0) return;
    setError(null);
    setPendingFiles((current) => [...current, ...files]);
  };

  const removePendingFile = (index: number) => {
    setPendingFiles((current) => current.filter((_file, fileIndex) => fileIndex !== index));
  };

  const startPendingFiles = async () => {
    const files = pendingFiles;
    if (files.length === 0) {
      setError('Add files');
      return;
    }
    if (!generateMp3 && !generateTxt) {
      setError('Select MP3, TXT or both');
      return;
    }

    setUploading(true);
    setError(null);
    const options = {
      generate_mp3: generateMp3,
      generate_txt: generateTxt,
      openai_api_key: openaiApiKey,
    };
    const results = await Promise.allSettled(files.map((file) => uploadTranscriptionFile(file, options)));
    const failures: string[] = [];
    const failedFiles: File[] = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        const job = result.value;
        mergeJob(job);
        attachEvents(job);
        return;
      }
      failures.push(errorMessage(result.reason));
      failedFiles.push(files[index]);
    });
    setPendingFiles(failedFiles);
    if (failures.length > 0) setError(failures.join('; '));
    setUploading(false);
  };

  const submitFileInput = (fileList: FileList | null) => {
    addFiles(Array.from(fileList ?? []));
    if (inputRef.current) inputRef.current.value = '';
  };

  const isFileDrag = (event: DragEvent<HTMLElement>) => Array.from(event.dataTransfer.types).includes('Files');

  const handleDragEnter = (event: DragEvent<HTMLElement>) => {
    if (!hasFiles || !isFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    dragDepth.current += 1;
    setDragging(true);
  };

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    if (!hasFiles || !isFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDragging(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    if (!hasFiles || !isFileDrag(event)) return;
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    if (!hasFiles || !isFileDrag(event)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    addFiles(Array.from(event.dataTransfer.files));
  };

  return (
    <main
      className={`app-shell${dragging && hasFiles ? ' is-dragging' : ''}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        ref={inputRef}
        className="hidden-file-input"
        type="file"
        multiple
        accept="audio/*,video/*,.mkv,.m4v,.mov,.webm"
        onChange={(event) => submitFileInput(event.currentTarget.files)}
      />
      <header className="app-header">
        <div>
          <p className="eyebrow">OpenAI transcription</p>
          <h1>Media Transcriber</h1>
        </div>
        <button type="button" className="icon-button" onClick={loadJobs} title="Refresh">
          <RefreshCcw size={17} />
        </button>
      </header>

      <section className="token-panel">
        <label htmlFor="openai-api-key">OpenAI token</label>
        <input
          id="openai-api-key"
          type="password"
          value={openaiApiKey}
          placeholder="sk-..."
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setOpenaiApiKey(event.currentTarget.value)}
        />
        <button
          type="button"
          className="icon-button token-clear"
          disabled={!openaiApiKey}
          onClick={() => setOpenaiApiKey('')}
          title="Clear saved token"
        >
          <Trash2 size={14} />
        </button>
      </section>

      {!hasFiles && <FileDropZone busy={uploading} onFiles={addFiles} />}

      {hasPendingFiles && (
        <section className={`work-panel${dragging ? ' is-dragging' : ''}`}>
          <div className="pending-files">
            {pendingFiles.map((file, index) => (
              <div className="pending-file" key={`${file.name}-${file.size}-${index}`}>
                <FileAudio size={17} />
                <div>
                  <strong>{file.name}</strong>
                  <span>{formatFileSize(file.size)}</span>
                </div>
                <button type="button" onClick={() => removePendingFile(index)} title="Remove file">
                  <X size={15} />
                </button>
              </div>
            ))}
          </div>

          <div className="run-controls">
            <button
              type="button"
              className="secondary-action"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
            >
              Add files
            </button>
            <div className="output-toggles" aria-label="Output formats">
              <label>
                <input
                  type="checkbox"
                  checked={generateMp3}
                  onChange={(event) => setGenerateMp3(event.currentTarget.checked)}
                />
                <span>MP3</span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={generateTxt}
                  onChange={(event) => setGenerateTxt(event.currentTarget.checked)}
                />
                <span>TXT</span>
              </label>
            </div>
            <button type="button" className="primary-action" disabled={!canStart} onClick={() => void startPendingFiles()}>
              {uploading ? 'Uploading' : 'Start'}
            </button>
          </div>
        </section>
      )}

      {hasJobs && !hasPendingFiles && (
        <div className="jobs-toolbar">
          <button
            type="button"
            className="secondary-action"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            Add files
          </button>
        </div>
      )}

      {error && (
        <div className="error-banner">
          <AlertCircle size={17} />
          <span>{error}</span>
        </div>
      )}

      {hasJobs && (
        <section className="jobs-list">
          {jobs.map((job) => (
            <JobRow key={job.id} job={job} />
          ))}
        </section>
      )}
    </main>
  );
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (error as { response?: { data?: { detail?: string } } }).response;
    if (response?.data?.detail) return response.data.detail;
  }
  if (error instanceof Error) return error.message;
  return 'Unexpected error';
}

function storedOpenaiApiKey(): string {
  try {
    return localStorage.getItem(OPENAI_API_KEY_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}
