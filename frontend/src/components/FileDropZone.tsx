import { Card, Flex, Text } from '@orcestr/ui';
import { useRef, useState } from 'react';
import { LuUpload } from 'react-icons/lu';

interface FileDropZoneProps {
  busy: boolean;
  onFiles: (files: File[]) => void;
}

export function FileDropZone({ busy, onFiles }: FileDropZoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const submitFiles = (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []);
    if (files.length > 0) onFiles(files);
  };

  return (
    <Card
      className={`drop-zone${dragging ? ' is-dragging' : ''}`}
      v="surface"
      size={4}
      interactive={!busy}
      onClick={() => {
        if (!busy) inputRef.current?.click();
      }}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        submitFiles(event.dataTransfer.files);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="audio/*,video/*,.mkv,.m4v,.mov,.webm"
        onChange={(event) => {
          submitFiles(event.currentTarget.files);
          event.currentTarget.value = '';
        }}
      />
      <Flex className="drop-zone-content" a="center" j="center" g={4}>
        <Flex className="drop-icon" a="center" j="center" aria-hidden="true">
          <LuUpload size={20} />
        </Flex>
        <Flex col g={1} className="drop-copy">
          <Text as="strong" fs="17px" fw={760}>
            {busy ? 'Uploading' : 'Drop files here'}
          </Text>
          <Text tone="muted" fs="13px">
            Click to select several audio or video files
          </Text>
        </Flex>
      </Flex>
    </Card>
  );
}
