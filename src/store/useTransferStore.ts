import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  ConnectionRequestCancelledPayload,
  ConnectionRequestPayload,
  DeviceConnectedPayload,
  DeviceDisconnectedPayload,
  ErrorPayload,
  FileProgressPayload,
  SendFileResponse,
  ServiceInfo,
  TransferDevice,
  TransferMessage,
  UrlMode,
} from '@/types/transfer';

const PLUGIN_PREFIX = 'plugin:ctxrun-plugin-transfer|';
const TRANSFER_STATUS_EVENT = 'transfer:status-changed';
let listenersInitInFlight = false;
const CHAT_HISTORY_LIMIT_PER_DEVICE = 200;
const DEVICE_RECONNECT_GRACE_MS = 180_000;
const reconnectGraceTimers = new Map<string, ReturnType<typeof globalThis.setTimeout>>();

interface TransferState {
  isRunning: boolean;
  isBusy: boolean;
  serviceInfo: ServiceInfo | null;
  urlMode: UrlMode;
  port: number | null;
  devices: TransferDevice[];
  selectedDeviceId: string | null;
  chatHistories: Record<string, TransferMessage[]>;
  lastError: string | null;
  pendingDevices: ConnectionRequestPayload[];
  respondConnectionRequest: (deviceId: string, accept: boolean) => Promise<void>;
  _unlistenFns: UnlistenFn[];

  clearError: () => void;
  startService: () => Promise<void>;
  stopService: () => Promise<void>;
  selectDevice: (deviceId: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  sendFile: (filePath: string) => Promise<void>;
  respondFileRequest: (deviceId: string, fileId: string, accept: boolean) => Promise<void>;
  loadHistory: (deviceId: string) => Promise<void>;
  initListeners: () => Promise<void>;
  resetRuntime: () => void;
  unlisten: () => void;
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function appendHistoryMessage(
  histories: Record<string, TransferMessage[]>,
  deviceId: string,
  message: TransferMessage
) {
  const currentHistory = histories[deviceId] ?? [];
  return {
    ...histories,
    [deviceId]: [...currentHistory, message].slice(-CHAT_HISTORY_LIMIT_PER_DEVICE),
  };
}

function upsertDevice(devices: TransferDevice[], nextDevice: TransferDevice) {
  const nextDevices = devices.filter((device) => device.id !== nextDevice.id);
  nextDevices.push(nextDevice);
  nextDevices.sort((left, right) => left.connectedAtMs - right.connectedAtMs);
  return nextDevices;
}

function normalizeDevice(device: TransferDevice): TransferDevice {
  return {
    ...device,
    presence: device.presence ?? 'connected',
  };
}

function clearReconnectGraceTimer(deviceId: string) {
  const timer = reconnectGraceTimers.get(deviceId);
  if (timer) {
    globalThis.clearTimeout(timer);
    reconnectGraceTimers.delete(deviceId);
  }
}

function clearAllReconnectGraceTimers() {
  reconnectGraceTimers.forEach((timer) => globalThis.clearTimeout(timer));
  reconnectGraceTimers.clear();
}

function basenameFromPath(filePath: string) {
  return filePath.split(/[\\/]/).pop() || filePath;
}

function createLocalTextMessage(deviceId: string, content: string): TransferMessage {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    deviceId,
    kind: 'text',
    direction: 'sent',
    content,
    timestampMs: Date.now(),
  };
}

function createLocalFileMessage(
  deviceId: string,
  response: SendFileResponse,
  filePath: string
): TransferMessage {
  return {
    id: response.fileId,
    deviceId,
    kind: 'file',
    direction: 'sent',
    fileId: response.fileId,
    fileName: response.fileName || basenameFromPath(filePath),
    fileSize: response.fileSize,
    status: 'pending',
    progressPercent: 0,
    timestampMs: Date.now(),
  };
}

function applyFileProgress(message: TransferMessage, progress: FileProgressPayload): TransferMessage {
  if (message.fileId !== progress.fileId) {
    return message;
  }

  return {
    ...message,
    fileName: progress.fileName,
    fileSize: progress.totalBytes,
    status: progress.status,
    progressPercent: progress.progressPercent,
    savedPath: progress.savedPath ?? message.savedPath,
  };
}

export const useTransferStore = create<TransferState>((set, get) => ({
  isRunning: false,
  isBusy: false,
  serviceInfo: null,
  urlMode: 'random',
  port: null,
  devices: [],
  selectedDeviceId: null,
  chatHistories: {},
  lastError: null,
  pendingDevices: [],
  _unlistenFns: [],

  clearError: () => set({ lastError: null }),

  startService: async () => {
    if (get().isBusy || get().isRunning) return;

    await get().initListeners();
    clearAllReconnectGraceTimers();
    set({ isBusy: true, lastError: null });

    try {
      const serviceInfo = await invoke<ServiceInfo>(`${PLUGIN_PREFIX}start_service`, {
        config: {
          urlMode: get().urlMode,
          port: get().port,
          bindAddress: null,
          saveDir: null,
        },
      });

      set({
        isRunning: true,
        isBusy: false,
        serviceInfo,
        devices: [],
        selectedDeviceId: null,
        chatHistories: {},
        lastError: null,
      });
      void emit(TRANSFER_STATUS_EVENT, { running: true });
    } catch (error) {
      set({
        isBusy: false,
        lastError: toErrorMessage(error),
      });
    }
  },

  stopService: async () => {
    if (get().isBusy || !get().isRunning) return;

    set({ isBusy: true });
    try {
      await invoke(`${PLUGIN_PREFIX}stop_service`);
      get().resetRuntime();
    } catch (error) {
      set({
        isBusy: false,
        lastError: toErrorMessage(error),
      });
    }
  },

  selectDevice: async (deviceId) => {
    set({ selectedDeviceId: deviceId });
    await get().loadHistory(deviceId);
  },

  sendMessage: async (content) => {
    const deviceId = get().selectedDeviceId;
    const trimmed = content.trim();
    if (!deviceId || !trimmed) return;
    const device = get().devices.find((item) => item.id === deviceId);
    if (device?.presence === 'reconnecting') return;

    try {
      await invoke(`${PLUGIN_PREFIX}send_message`, {
        request: {
          deviceId,
          content: trimmed,
        },
      });

      const message = createLocalTextMessage(deviceId, trimmed);
      set((state) => ({
        chatHistories: appendHistoryMessage(state.chatHistories, deviceId, message),
      }));
    } catch (error) {
      set({ lastError: toErrorMessage(error) });
    }
  },

  sendFile: async (filePath) => {
    const deviceId = get().selectedDeviceId;
    if (!deviceId || !filePath) return;
    const device = get().devices.find((item) => item.id === deviceId);
    if (device?.presence === 'reconnecting') return;

    try {
      const response = await invoke<SendFileResponse>(`${PLUGIN_PREFIX}send_file`, {
        request: {
          deviceId,
          filePath,
        },
      });

      const message = createLocalFileMessage(deviceId, response, filePath);
      set((state) => ({
        chatHistories: appendHistoryMessage(state.chatHistories, deviceId, message),
      }));
    } catch (error) {
      set({ lastError: toErrorMessage(error) });
    }
  },

  respondFileRequest: async (deviceId, fileId, accept) => {
    try {
      await invoke(`${PLUGIN_PREFIX}respond_file_request`, { deviceId, fileId, accept });
      set((state) => {
        const history = state.chatHistories[deviceId] ?? [];
        return {
          chatHistories: {
            ...state.chatHistories,
            [deviceId]: history.map((message) =>
              message.fileId === fileId ? { ...message, status: accept ? 'pending' : 'rejected' } : message
            ),
          },
        };
      });
    } catch (error) {
      set({ lastError: toErrorMessage(error) });
    }
  },

  respondConnectionRequest: async (deviceId, accept) => {
    try {
      await invoke(`${PLUGIN_PREFIX}respond_connection_request`, { deviceId, accept });
      if (!accept) {
        set((state) => ({
          pendingDevices: state.pendingDevices.filter((d) => d.deviceId !== deviceId),
        }));
      }
    } catch (error) {
      set({ lastError: toErrorMessage(error) });
    }
  },

  loadHistory: async (deviceId) => {
    if (!deviceId) return;

    try {
      const history = await invoke<TransferMessage[]>(`${PLUGIN_PREFIX}get_chat_history`, {
        request: { deviceId },
      });
      set((state) => ({
        chatHistories: {
          ...state.chatHistories,
          [deviceId]: history.slice(-CHAT_HISTORY_LIMIT_PER_DEVICE),
        },
      }));
    } catch (error) {
      set({ lastError: toErrorMessage(error) });
    }
  },

  initListeners: async () => {
    if (get()._unlistenFns.length > 0 || listenersInitInFlight) return;
    listenersInitInFlight = true;

    try {
      const unlistenConnectionRequest = await listen<ConnectionRequestPayload>(
        'transfer:connection-request',
        (event) => {
          set((state) => ({
            pendingDevices: [
              ...state.pendingDevices.filter((device) => device.deviceId !== event.payload.deviceId),
              event.payload,
            ],
          }));
        }
      );

      const unlistenConnectionRequestCancelled = await listen<ConnectionRequestCancelledPayload>(
        'transfer:connection-request-cancelled',
        (event) => {
          set((state) => ({
            pendingDevices: state.pendingDevices.filter((device) => device.deviceId !== event.payload.deviceId),
          }));
        }
      );

      const unlistenDeviceConnected = await listen<DeviceConnectedPayload>(
        'transfer:device-connected',
        (event) => {
          const device = normalizeDevice(event.payload.device);
          clearReconnectGraceTimer(device.id);
          set((state) => ({
            devices: upsertDevice(state.devices, device),
            pendingDevices: state.pendingDevices.filter((d) => d.deviceId !== device.id),
            selectedDeviceId: state.selectedDeviceId ?? device.id,
          }));
          void get().loadHistory(device.id);
        }
      );

      const unlistenDeviceDisconnected = await listen<DeviceDisconnectedPayload>(
        'transfer:device-disconnected',
        (event) => {
          const disconnectedId = event.payload.deviceId;
          clearReconnectGraceTimer(disconnectedId);
          set((state) => {
            const nextDevices = state.devices.map((device) =>
              device.id === disconnectedId ? { ...device, presence: 'reconnecting' as const } : device
            );
            return {
              devices: nextDevices,
              selectedDeviceId: state.selectedDeviceId,
            };
          });
          const timer = globalThis.setTimeout(() => {
            reconnectGraceTimers.delete(disconnectedId);
            useTransferStore.setState((state) => {
              const target = state.devices.find((device) => device.id === disconnectedId);
              if (!target || target.presence !== 'reconnecting') {
                return state;
              }
              const nextDevices = state.devices.filter((device) => device.id !== disconnectedId);
              return {
                devices: nextDevices,
                selectedDeviceId:
                  state.selectedDeviceId === disconnectedId
                    ? nextDevices[0]?.id ?? null
                    : state.selectedDeviceId,
              };
            });
          }, DEVICE_RECONNECT_GRACE_MS);
          reconnectGraceTimers.set(disconnectedId, timer);
        }
      );

      const unlistenMessageReceived = await listen<TransferMessage>(
        'transfer:message-received',
        (event) => {
          const message = event.payload;
          set((state) => ({
            chatHistories: appendHistoryMessage(state.chatHistories, message.deviceId, message),
          }));
        }
      );

      const unlistenFileRequest = await listen<TransferMessage>('transfer:file-request', (event) => {
        const message = event.payload;
        set((state) => ({
          chatHistories: appendHistoryMessage(state.chatHistories, message.deviceId, message),
        }));
      });

      const unlistenFileReceived = await listen<TransferMessage>('transfer:file-received', (event) => {
        const message = event.payload;
        set((state) => {
          const history = state.chatHistories[message.deviceId] ?? [];
          const exists = history.some(m => m.fileId === message.fileId);
          let newHistory;
          if (exists) {
            newHistory = history.map(m => m.fileId === message.fileId ? { ...m, ...message } : m);
          } else {
            newHistory = [...history, message];
          }
          return {
            chatHistories: {
              ...state.chatHistories,
              [message.deviceId]: newHistory.slice(-CHAT_HISTORY_LIMIT_PER_DEVICE),
            },
          };
        });
      });

      const unlistenFileProgress = await listen<FileProgressPayload>(
        'transfer:file-progress',
        (event) => {
          const progress = event.payload;
          set((state) => {
            const history = state.chatHistories[progress.deviceId] ?? [];
            const exists = history.some(m => m.fileId === progress.fileId);
            
            let updatedHistory;
            if (exists) {
              updatedHistory = history.map((message) => applyFileProgress(message, progress));
            } else {
              const newMessage: TransferMessage = {
                id: progress.fileId,
                deviceId: progress.deviceId,
                kind: 'file',
                direction: progress.direction,
                fileId: progress.fileId,
                fileName: progress.fileName,
                fileSize: progress.totalBytes,
                status: progress.status,
                progressPercent: progress.progressPercent,
                timestampMs: Date.now(),
                savedPath: progress.savedPath
              };
              updatedHistory = [...history, newMessage];
            }

            return {
              chatHistories: {
                ...state.chatHistories,
                [progress.deviceId]: updatedHistory.slice(-CHAT_HISTORY_LIMIT_PER_DEVICE),
              },
            };
          });
        }
      );

      const unlistenServiceStopped = await listen('transfer:service-stopped', () => {
        get().resetRuntime();
      });

      const unlistenError = await listen<ErrorPayload>('transfer:error', (event) => {
        set({ lastError: event.payload.message });
      });

      set({
        _unlistenFns: [
          unlistenConnectionRequest,
          unlistenConnectionRequestCancelled,
          unlistenDeviceConnected,
          unlistenDeviceDisconnected,
          unlistenMessageReceived,
          unlistenFileRequest,
          unlistenFileReceived,
          unlistenFileProgress,
          unlistenServiceStopped,
          unlistenError,
        ],
      });
    } finally {
      listenersInitInFlight = false;
    }
  },

  resetRuntime: () => {
    clearAllReconnectGraceTimers();
    set({
      isRunning: false,
      isBusy: false,
      serviceInfo: null,
      devices: [],
      pendingDevices: [],
      selectedDeviceId: null,
      chatHistories: {},
    });
    void emit(TRANSFER_STATUS_EVENT, { running: false });
  },

  unlisten: () => {
    get()._unlistenFns.forEach((fn) => fn());
    set({ _unlistenFns: [] });
  },
}));
