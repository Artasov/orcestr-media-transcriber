import { UploadCloud } from 'lucide-react';
import { useRef, useState } from 'react';

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
    <section
      className={`drop-zone${dragging ? ' is-dragging' : ''}`}
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
      <div className="drop-icon" aria-hidden="true">
        <UploadCloud size={18} />
      </div>
      <div className="drop-copy">
        <strong>{busy ? 'Uploading' : 'Drop files here'}</strong>
        <span>Click to select several audio or video files</span>
      </div>
    </section>
  );
}
