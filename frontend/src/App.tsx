import { Alert, Box, Button, Card, Checkbox, Field, Flex, IconButton, Text, TextField } from '@orcestr/ui';
import type { DragEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { LuFileAudio, LuRefreshCcw, LuX } from 'react-icons/lu';
import {
  createTranscriptionsFromPaths,
  fetchTranscriptions,
  jobEventsUrl,
  uploadTranscriptionFile,
} from './api/client';
import {
  isDesktopApp,
  listenForDesktopDrops,
  selectDesktopMediaFiles,
  type DesktopMediaFile,
} from './api/desktop';
import type { JobEventPayload, TranscriptionJob } from './api/types';
import { FileDropZone } from './components/FileDropZone';
import { JobRow } from './components/JobRow';

const OPENAI_API_KEY_STORAGE_KEY = 'orcestr-media-transcriber.openaiApiKey';

interface PendingMediaFile {
  id: string;
  name: string;
  size: number;
  path?: string;
  file?: File;
}

export function App() {
  const [jobs, setJobs] = useState<TranscriptionJob[]>([]);
  const [pendingFiles, setPendingFiles] = useState<PendingMediaFile[]>([]);
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
    if (!isDesktopApp()) return;
    let disposed = false;
    let stopListening: (() => void) | undefined;
    void listenForDesktopDrops({
      onEnter: () => setDragging(true),
      onLeave: () => {
        dragDepth.current = 0;
        setDragging(false);
      },
      onDrop: (files) => addDesktopFiles(files),
      onError: (dropError) => setError(errorMessage(dropError)),
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      stopListening = unlisten;
    });
    return () => {
      disposed = true;
      stopListening?.();
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

  const addBrowserFiles = (files: File[]) => {
    if (files.length === 0) return;
    setError(null);
    setPendingFiles((current) => [
      ...current,
      ...files.map((file) => ({
        id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
        name: file.name,
        size: file.size,
        file,
      })),
    ]);
  };

  const addDesktopFiles = (files: DesktopMediaFile[]) => {
    if (files.length === 0) return;
    setError(null);
    setPendingFiles((current) => [
      ...current,
      ...files.map((file) => ({
        id: `${file.path}-${crypto.randomUUID()}`,
        ...file,
      })),
    ]);
  };

  const selectFiles = async () => {
    if (!isDesktopApp()) {
      inputRef.current?.click();
      return;
    }
    try {
      addDesktopFiles(await selectDesktopMediaFiles());
    } catch (selectError) {
      setError(errorMessage(selectError));
    }
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
    const results = await Promise.allSettled(
      files.map(async (pendingFile) => {
        if (pendingFile.path) {
          const [job] = await createTranscriptionsFromPaths([pendingFile.path], options);
          return job;
        }
        if (pendingFile.file) return uploadTranscriptionFile(pendingFile.file, options);
        throw new Error(`File data is missing: ${pendingFile.name}`);
      }),
    );
    const failures: string[] = [];
    const failedFiles: PendingMediaFile[] = [];
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
    addBrowserFiles(Array.from(fileList ?? []));
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
    addBrowserFiles(Array.from(event.dataTransfer.files));
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
      <Flex as="header" className="app-header" a="center" j="sb" g={4}>
        <Box>
          <Text as="p" tone="primary" fs="13px" fw={750} className="eyebrow">
            OpenAI transcription
          </Text>
          <Text as="h1" fs="32px" fw={780} lh="1.12">
            Media Transcriber
          </Text>
        </Box>
        <IconButton
          aria-label="Refresh"
          title="Refresh"
          icon={<LuRefreshCcw size={17} />}
          onClick={loadJobs}
          size={4}
          v="surface"
        />
      </Flex>

      <Field label="OpenAI token" htmlFor="openai-api-key" className="token-field">
        <TextField
          id="openai-api-key"
          type="password"
          value={openaiApiKey}
          placeholder="sk-..."
          autoComplete="off"
          spellCheck={false}
          clearable
          clearLabel="Clear saved token"
          onClear={() => setOpenaiApiKey('')}
          onChange={(event) => setOpenaiApiKey(event.currentTarget.value)}
          fullWidth
        />
      </Field>

      {!hasFiles && <FileDropZone busy={uploading} onSelect={() => void selectFiles()} onFiles={addBrowserFiles} />}

      {hasPendingFiles && (
        <Card className={`work-panel${dragging ? ' is-dragging' : ''}`} v="surface" size={3}>
          <Box className="pending-files">
            {pendingFiles.map((file, index) => (
              <Card className="pending-file" key={file.id} v="soft" size={2}>
                <LuFileAudio size={18} />
                <Box className="pending-file-copy">
                  <Text as="strong" truncate>
                    {file.name}
                  </Text>
                  <Text tone="muted" fs="12px" truncate>
                    {formatFileSize(file.size)}
                  </Text>
                </Box>
                <IconButton
                  aria-label="Remove file"
                  title="Remove file"
                  icon={<LuX size={15} />}
                  onClick={() => removePendingFile(index)}
                  size={2}
                  v="ghost"
                />
              </Card>
            ))}
          </Box>

          <Flex className="run-controls" a="center" wrap g={2}>
            <Button type="button" v="surface" disabled={uploading} onClick={() => void selectFiles()}>
              Add files
            </Button>
            <Flex className="output-toggles" role="group" aria-label="Output formats" a="center" g={2}>
              <Checkbox label="MP3" checked={generateMp3} onCheckedChange={setGenerateMp3} />
              <Checkbox label="TXT" checked={generateTxt} onCheckedChange={setGenerateTxt} />
            </Flex>
            <Button type="button" disabled={!canStart} loading={uploading} onClick={() => void startPendingFiles()}>
              {uploading ? 'Uploading' : 'Start'}
            </Button>
          </Flex>
        </Card>
      )}

      {hasJobs && !hasPendingFiles && (
        <Flex className="jobs-toolbar">
          <Button type="button" v="surface" disabled={uploading} onClick={() => void selectFiles()}>
            Add files
          </Button>
        </Flex>
      )}

      {error && (
        <Alert tone="danger" className="error-banner">
          {error}
        </Alert>
      )}

      {hasJobs && (
        <Box as="section" className="jobs-list">
          {jobs.map((job) => (
            <JobRow key={job.id} job={job} />
          ))}
        </Box>
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
