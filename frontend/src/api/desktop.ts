import { invoke } from '@tauri-apps/api/core';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open } from '@tauri-apps/plugin-dialog';

export interface DesktopMediaFile {
  path: string;
  name: string;
  size: number;
}

export interface DesktopUpdate {
  currentVersion: string;
  latestVersion: string;
  downloadUrl: string;
}

interface DesktopDropHandlers {
  onEnter: () => void;
  onLeave: () => void;
  onDrop: (files: DesktopMediaFile[]) => void;
  onError: (error: unknown) => void;
}

export function isDesktopApp(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

export async function selectDesktopMediaFiles(): Promise<DesktopMediaFile[]> {
  const selected = await open({
    multiple: true,
    directory: false,
    filters: [
      {
        name: 'Audio and video',
        extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'mp4', 'mkv', 'mov', 'm4v', 'webm'],
      },
    ],
  });
  const paths = selected === null ? [] : Array.isArray(selected) ? selected : [selected];
  return desktopMediaFileDetails(paths);
}

export async function listenForDesktopDrops(handlers: DesktopDropHandlers): Promise<UnlistenFn> {
  return getCurrentWebview().onDragDropEvent((event) => {
    if (event.payload.type === 'enter' || event.payload.type === 'over') {
      handlers.onEnter();
      return;
    }
    if (event.payload.type === 'leave') {
      handlers.onLeave();
      return;
    }
    handlers.onLeave();
    void desktopMediaFileDetails(event.payload.paths).then(handlers.onDrop).catch(handlers.onError);
  });
}

export async function openDesktopOutputFile(path: string): Promise<void> {
  await invoke('open_output_file', { path });
}

export async function revealDesktopOutputFile(path: string): Promise<void> {
  await invoke('reveal_output_file', { path });
}

export async function openExternalUrl(url: string): Promise<void> {
  if (!isDesktopApp()) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  await invoke('open_external_url', { url });
}

export async function checkForDesktopUpdate(): Promise<DesktopUpdate | null> {
  if (!isDesktopApp()) return null;
  return invoke<DesktopUpdate | null>('check_for_update');
}

async function desktopMediaFileDetails(paths: string[]): Promise<DesktopMediaFile[]> {
  if (paths.length === 0) return [];
  return invoke<DesktopMediaFile[]>('media_file_details', { paths });
}
