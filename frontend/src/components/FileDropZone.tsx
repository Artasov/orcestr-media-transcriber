import { Card, Flex, Text } from '@orcestr/ui';
import { useState } from 'react';
import { LuUpload } from 'react-icons/lu';

interface FileDropZoneProps {
  busy: boolean;
  onSelect: () => void;
  onFiles: (files: File[]) => void;
}

export function FileDropZone({ busy, onSelect, onFiles }: FileDropZoneProps) {
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
        if (!busy) onSelect();
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
