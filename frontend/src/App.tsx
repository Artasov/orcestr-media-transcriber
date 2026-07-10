import { Alert, Box, Button, Card, Checkbox, Field, Flex, IconButton, Text, TextField } from '@orcestr/ui';
import type { DragEvent, MouseEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { LuCircleArrowUp, LuFileAudio, LuTrash2, LuX } from 'react-icons/lu';
import {
  createTranscriptionsFromPaths,
  fetchTranscriptions,
  jobEventsUrl,
  uploadTranscriptionFile,
} from './api/client';
import {
  checkForDesktopUpdate,
  isDesktopApp,
  listenForDesktopDrops,
  openExternalUrl,
  selectDesktopMediaFiles,
  type DesktopUpdate,
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
  const [availableUpdate, setAvailableUpdate] = useState<DesktopUpdate | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dragDepth = useRef(0);
  const eventSources = useRef<Map<string, EventSource>>(new Map());

  const hasPendingFiles = pendingFiles.length > 0;
  const hasJobs = jobs.length > 0;
  const hasFiles = hasPendingFiles || hasJobs;
  const canStart = hasPendingFiles && !uploading;

  const updateOpenaiApiKey = (value: string) => {
    setOpenaiApiKey(value);
    saveOpenaiApiKey(value);
  };

  const resetOpenaiApiKey = () => {
    setOpenaiApiKey('');
    clearOpenaiApiKey();
  };

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
    let active = true;
    void checkForDesktopUpdate()
      .then((update) => {
        if (active) setAvailableUpdate(update);
      })
      .catch(() => undefined);
    return () => {
      active = false;
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

  const openHeaderLink = (event: MouseEvent<HTMLAnchorElement>, url: string) => {
    event.preventDefault();
    void openExternalUrl(url);
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
      <Flex as="header" className="app-header" a="center" g={4}>
        <Box>
          <Text as="p" tone="primary" fs="13px" fw={750} className="eyebrow">
            <a
              href="https://orcestr.com"
              target="_blank"
              rel="noreferrer"
              onClick={(event) => openHeaderLink(event, 'https://orcestr.com')}
            >
              orcestr.com
            </a>{' '}
            by{' '}
            <a
              href="https://github.com/Artasov"
              target="_blank"
              rel="noreferrer"
              onClick={(event) => openHeaderLink(event, 'https://github.com/Artasov')}
            >
              Artasov
            </a>
          </Text>
          <Text as="h1" fs="32px" fw={780} lh="1.12">
            Media Transcriber
          </Text>
        </Box>
      </Flex>

      <Field label="OpenAI token" htmlFor="openai-api-key" className="token-field">
        <Flex className="token-field-control" a="center" g={2}>
          <TextField
            id="openai-api-key"
            type="password"
            value={openaiApiKey}
            placeholder="sk-..."
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => updateOpenaiApiKey(event.currentTarget.value)}
            fullWidth
          />
          <Button type="button" v="surface" disabled={!openaiApiKey.trim()} onClick={resetOpenaiApiKey}>
            <LuTrash2 size={15} />
            Reset
          </Button>
        </Flex>
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

      {availableUpdate && (
        <Card className="update-notice" v="surface" size={3} role="status">
          <LuCircleArrowUp className="update-notice-icon" size={24} aria-hidden="true" />
          <Box className="update-notice-copy">
            <Text as="strong" fw={760}>
              Version {availableUpdate.latestVersion} is available
            </Text>
            <Text as="p" tone="muted" fs="12px">
              You are using version {availableUpdate.currentVersion}.
            </Text>
          </Box>
          <Button
            type="button"
            size={2}
            className="update-download-button"
            onClick={() => void openExternalUrl(availableUpdate.downloadUrl)}
          >
            Download update
          </Button>
          <IconButton
            aria-label="Dismiss update"
            title="Dismiss update"
            icon={<LuX size={15} />}
            onClick={() => setAvailableUpdate(null)}
            size={2}
            v="ghost"
          />
        </Card>
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

function saveOpenaiApiKey(value: string): void {
  const apiKey = value.trim();
  if (!apiKey) {
    clearOpenaiApiKey();
    return;
  }
  try {
    localStorage.setItem(OPENAI_API_KEY_STORAGE_KEY, apiKey);
  } catch {
    return;
  }
}

function clearOpenaiApiKey(): void {
  try {
    localStorage.removeItem(OPENAI_API_KEY_STORAGE_KEY);
  } catch {
    return;
  }
}
