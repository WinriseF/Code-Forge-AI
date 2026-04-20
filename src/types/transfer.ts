export type UrlMode = 'fixed' | 'random';
export type TransferMessageKind = 'text' | 'file' | 'system';
export type TransferMessageDirection = 'sent' | 'received' | 'system';
export type TransferDevicePresence = 'connected' | 'reconnecting';
export type TransferFileStatus =
  | 'pending'
  | 'pending_approval'
  | 'rejected'
  | 'transferring'
  | 'completed'
  | 'failed';

export interface ServiceConfig {
  urlMode: UrlMode;
  port?: number | null;
  bindAddress?: string | null;
  saveDir?: string | null;
}

export interface ServiceInfo {
  url: string;
  port: number;
  bindAddress: string;
  qrMatrix: boolean[][];
  urlMode: UrlMode;
  saveDir: string;
}

export interface TransferNetworkInterface {
  id: string;
  name: string;
  addresses: string[];
}

export interface TransferDevice {
  id: string;
  name: string;
  deviceType: string;
  ipAddress: string;
  connectedAtMs: number;
  presence?: TransferDevicePresence;
}

export interface TransferMessage {
  id: string;
  deviceId: string;
  kind: TransferMessageKind;
  direction: TransferMessageDirection;
  content?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  fileId?: string | null;
  savedPath?: string | null;
  status?: TransferFileStatus | null;
  progressPercent?: number | null;
  timestampMs: number;
}

export interface SendFileResponse {
  fileId: string;
  fileName: string;
  fileSize: number;
}

export interface DeviceConnectedPayload {
  device: TransferDevice;
}

export interface DeviceDisconnectedPayload {
  deviceId: string;
  reason: string;
}

export interface ErrorPayload {
  message: string;
  deviceId?: string | null;
}

export interface FileProgressPayload {
  deviceId: string;
  fileId: string;
  fileName: string;
  direction: TransferMessageDirection;
  status: TransferFileStatus;
  transferredBytes: number;
  totalBytes: number;
  progressPercent: number;
  speedBytesPerSec: number;
  savedPath?: string | null;
}

export interface ConnectionRequestPayload {
  deviceId: string;
  name: string;
  deviceType: string;
  ipAddress: string;
}

export interface ConnectionRequestCancelledPayload {
  deviceId: string;
  reason: string;
}
