import { Badge, Box, Button, Card, Flex, Text, TextArea } from '@orcestr/ui';
import { useEffect, useRef, useState } from 'react';
import {
  LuCheck,
  LuCircleCheckBig,
  LuCircleX,
  LuClipboard,
  LuExternalLink,
  LuFileAudio,
  LuFileText,
  LuFileVideo,
  LuFolderOpen,
  LuLoaderCircle,
} from 'react-icons/lu';
import { isDesktopApp, openDesktopOutputFile, revealDesktopOutputFile } from '../api/desktop';
import type { TranscriptionJob } from '../api/types';

interface JobRowProps {
  job: TranscriptionJob;
}

export function JobRow({ job }: JobRowProps) {
  const progress = progressValue(job);
  const done = job.status === 'completed';
  const failed = job.status === 'failed';
  const [copied, setCopied] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyResetTimer.current !== null) clearTimeout(copyResetTimer.current);
    },
    [],
  );

  const copyText = async () => {
    if (!job.transcript) return;
    try {
      await navigator.clipboard.writeText(job.transcript);
      setActionError(null);
      setCopied(true);
      if (copyResetTimer.current !== null) clearTimeout(copyResetTimer.current);
      copyResetTimer.current = setTimeout(() => setCopied(false), 3000);
    } catch (error) {
      setCopied(false);
      setActionError(actionErrorMessage(error));
    }
  };

  const runOutputAction = async (action: (path: string) => Promise<void>, path: string) => {
    try {
      setActionError(null);
      await action(path);
    } catch (error) {
      setActionError(actionErrorMessage(error));
    }
  };

  return (
    <Card className={`job-row status-${job.status}`} v="surface" size={3}>
      <Flex className="job-main" g={3}>
        <Flex className="job-icon" a="center" j="center" aria-hidden="true">
          {job.source_kind === 'video' ? <LuFileVideo size={20} /> : <LuFileAudio size={20} />}
        </Flex>
        <Box className="job-content">
          <Flex className="job-heading" a="start" j="sb" g={3}>
            <Text as="h2" fs="16px" fw={760} lh="1.3">
              {job.name}
            </Text>
            <StatusBadge job={job} />
          </Flex>
          <Flex className="job-meta" wrap g={2}>
            <Text tone="muted" fs="12px">
              {formatFileSize(job.size)}
            </Text>
            <Text tone="muted" fs="12px">
              {job.source_kind}
            </Text>
            <Text tone="muted" fs="12px">
              {job.generate_mp3 ? 'MP3' : ''}
              {job.generate_mp3 && job.generate_txt ? ' + ' : ''}
              {job.generate_txt ? 'TXT' : ''}
            </Text>
            {job.chunks_count > 0 && (
              <Text tone="muted" fs="12px">
                {job.chunks_completed}/{job.chunks_count} chunks
              </Text>
            )}
          </Flex>
          {!done && !failed && (
            <Box className="progress-track" aria-label="Processing progress">
              <Box className="progress-bar" style={{ width: progress === null ? '35%' : `${progress}%` }} />
            </Box>
          )}
          {failed && (
            <Text as="p" tone="danger" className="job-error">
              {job.error ?? 'Transcription failed'}
            </Text>
          )}
        </Box>
      </Flex>

      {done && (
        <Box className="result-panel">
          <Box className="output-paths">
            {job.transcript_path && (
              <OutputFileRow
                kind="TXT"
                path={job.transcript_path}
                onOpen={(path) => void runOutputAction(openDesktopOutputFile, path)}
                onReveal={(path) => void runOutputAction(revealDesktopOutputFile, path)}
              />
            )}
            {job.audio_path && (
              <OutputFileRow
                kind="MP3"
                path={job.audio_path}
                onOpen={(path) => void runOutputAction(openDesktopOutputFile, path)}
                onReveal={(path) => void runOutputAction(revealDesktopOutputFile, path)}
              />
            )}
          </Box>
          {job.transcript && <TextArea value={job.transcript} readOnly className="transcript-area" />}
          {job.transcript && (
            <Flex className="result-actions" wrap g={2}>
              <Button
                type="button"
                v="surface"
                onClick={copyText}
                leftIcon={copied ? <LuCheck size={16} /> : <LuClipboard size={16} />}
              >
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </Flex>
          )}
          {actionError && (
            <Text as="p" tone="danger" className="result-action-error">
              {actionError}
            </Text>
          )}
        </Box>
      )}
    </Card>
  );
}

function OutputFileRow({
  kind,
  path,
  onOpen,
  onReveal,
}: {
  kind: 'TXT' | 'MP3';
  path: string;
  onOpen: (path: string) => void;
  onReveal: (path: string) => void;
}) {
  return (
    <Flex className="output-file" a="center" j="sb" g={3}>
      <Flex className="output-file-copy" a="center" g={2}>
        {kind === 'TXT' ? <LuFileText size={18} /> : <LuFileAudio size={18} />}
        <Box>
          <Text as="strong" fs="12px">
            {kind}
          </Text>
          <Text as="p" tone="muted" fs="12px" title={path}>
            {path}
          </Text>
        </Box>
      </Flex>
      {isDesktopApp() && (
        <Flex className="output-file-actions" wrap g={2}>
          <Button type="button" v="surface" size={2} onClick={() => onOpen(path)} leftIcon={<LuExternalLink size={15} />}>
            Open File
          </Button>
          <Button type="button" v="surface" size={2} onClick={() => onReveal(path)} leftIcon={<LuFolderOpen size={15} />}>
            Open Folder
          </Button>
        </Flex>
      )}
    </Flex>
  );
}

function actionErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  return 'The action could not be completed';
}

function StatusBadge({ job }: { job: TranscriptionJob }) {
  if (job.status === 'completed') {
    return (
      <Badge tone="success" icon={<LuCircleCheckBig size={14} />} v="surface">
        Done
      </Badge>
    );
  }
  if (job.status === 'failed') {
    return (
      <Badge tone="danger" icon={<LuCircleX size={14} />} v="surface">
        Failed
      </Badge>
    );
  }
  return (
    <Badge tone="primary" icon={<LuLoaderCircle className="spin-icon" size={14} />} v="surface">
      {job.status === 'queued' ? 'Queued' : job.generate_txt ? 'Transcribing' : 'Processing'}
    </Badge>
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
