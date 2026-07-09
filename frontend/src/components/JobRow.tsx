import { Badge, Box, Button, Card, Flex, LinkButton, Text, TextArea } from '@orcestr/ui';
import { LuCircleCheckBig, LuCircleX, LuClipboard, LuDownload, LuFileAudio, LuFileVideo, LuLoaderCircle } from 'react-icons/lu';
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
            {job.audio_path && (
              <Text tone="muted" fs="12px">
                MP3: {job.audio_path}
              </Text>
            )}
            {job.transcript_path && (
              <Text tone="muted" fs="12px">
                TXT: {job.transcript_path}
              </Text>
            )}
          </Box>
          {job.transcript && <TextArea value={job.transcript} readOnly className="transcript-area" />}
          <Flex className="result-actions" wrap g={2}>
            <Button type="button" v="surface" onClick={copyText} disabled={!job.transcript} leftIcon={<LuClipboard size={16} />}>
              Copy
            </Button>
            {job.transcript_path && (
              <LinkButton href={transcriptDownloadUrl(job.id)} v="surface" leftIcon={<LuDownload size={16} />}>
                Download TXT
              </LinkButton>
            )}
          </Flex>
        </Box>
      )}
    </Card>
  );
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
