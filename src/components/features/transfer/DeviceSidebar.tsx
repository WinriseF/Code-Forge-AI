import { MonitorSmartphone, Smartphone, Laptop, Check, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ConnectionRequestPayload, TransferDevice } from '@/types/transfer';
import { cn } from '@/lib/utils';

interface DeviceSidebarProps {
  isRunning: boolean;
  devices: TransferDevice[];
  pendingDevices: ConnectionRequestPayload[];
  selectedDeviceId: string | null;
  onSelect: (deviceId: string) => void;
  onRespondConnection: (deviceId: string, accept: boolean) => void;
}

function getDeviceIcon(type: string) {
  const t = type.toLowerCase();
  if (t.includes('ios') || t.includes('android')) return <Smartphone size={20} />;
  if (t.includes('mac') || t.includes('windows') || t.includes('linux')) return <Laptop size={20} />;
  return <MonitorSmartphone size={20} />;
}

export function DeviceSidebar({ isRunning, devices, pendingDevices, selectedDeviceId, onSelect, onRespondConnection }: DeviceSidebarProps) {
  const { t } = useTranslation();
  const isEmpty = devices.length === 0 && pendingDevices.length === 0;

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col">
      {isEmpty ? (
        <div className="p-6 text-center text-sm text-muted-foreground/60 flex flex-col items-center gap-3 mt-10">
          <MonitorSmartphone size={32} className="opacity-20" />
          <p>{isRunning ? t('transfer.waitingConnection') : t('transfer.sidebarIdleBody')}</p>
        </div>
      ) : (
        <div className="flex flex-col py-2">
          {pendingDevices.map((pending) => (
            <div
              key={pending.deviceId}
              className="flex items-center gap-3 px-4 py-3 border-l-2 border-amber-500/60 bg-amber-500/5"
            >
              <div className="w-10 h-10 rounded-md flex items-center justify-center shrink-0 bg-amber-500/10 text-amber-600">
                {getDeviceIcon(pending.deviceType)}
              </div>
              <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                <span className="font-medium text-sm text-foreground truncate">{pending.name}</span>
                <span className="text-xs text-muted-foreground truncate">{pending.ipAddress}</span>
              </div>
              <div className="flex gap-1 shrink-0">
                <button
                  onClick={() => onRespondConnection(pending.deviceId, true)}
                  className="p-1.5 rounded-md bg-green-500/10 text-green-600 hover:bg-green-500/20 transition-colors"
                  title={t('transfer.accept')}
                >
                  <Check size={16} />
                </button>
                <button
                  onClick={() => onRespondConnection(pending.deviceId, false)}
                  className="p-1.5 rounded-md bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
                  title={t('transfer.reject')}
                >
                  <X size={16} />
                </button>
              </div>
            </div>
          ))}

          {devices.map((device) => {
            const selected = selectedDeviceId === device.id;
            const isReconnecting = device.presence === 'reconnecting';
            return (
              <button
                key={device.id}
                onClick={() => onSelect(device.id)}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 text-left transition-colors cursor-pointer border-l-2",
                  selected ? "bg-secondary border-primary" : "border-transparent hover:bg-secondary/50",
                  isReconnecting && "bg-amber-500/5"
                )}
              >
                <div
                  className={cn(
                    "w-10 h-10 rounded-md flex items-center justify-center shrink-0",
                    isReconnecting
                      ? "bg-amber-500/10 text-amber-600"
                      : selected
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-muted-foreground"
                  )}
                >
                  {getDeviceIcon(device.deviceType)}
                </div>
                <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm text-foreground truncate">{device.name}</span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                        isReconnecting
                          ? "bg-amber-500/10 text-amber-700"
                          : "bg-emerald-500/10 text-emerald-700"
                      )}
                    >
                      {isReconnecting ? t('transfer.statusReconnecting') : t('transfer.statusConnected')}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground truncate">{device.ipAddress}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
