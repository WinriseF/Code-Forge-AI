export type PreviewType =
  | 'image'
  | 'video'
  | 'audio'
  | 'code'
  | 'markdown'
  | 'html'
  | 'pdf'
  | 'docx'
  | 'archive'
  | 'binary'
  | 'office';

export type PreviewMode = 'default' | 'source' | 'rendered' | 'formatted' | 'table';

export interface FileMeta {
  path: string;
  name: string;
  size: number;
  previewType: PreviewType;
  supportedModes: PreviewMode[];
  defaultMode: PreviewMode;
  mime: string;
}

export interface ArchiveEntry {
  index: number;
  path: string;
  name: string;
  size: number | null;
  compressedSize: number | null;
  isDir: boolean;
  isSafePath: boolean;
  previewable: boolean;
}

export interface ArchiveListing {
  format: string;
  entries: ArchiveEntry[];
  totalSize: number;
  totalCompressedSize: number | null;
  truncated: boolean;
  maxPreviewBytes: number;
}

export type ArchiveEntryPreviewKind = 'text' | 'image' | 'unsupported';

export interface ArchiveEntryPreview {
  entry: ArchiveEntry;
  kind: ArchiveEntryPreviewKind;
  mime: string;
  language: string | null;
  encoding: string | null;
  text: string | null;
  dataUrl: string | null;
  message: string | null;
}
