import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OcrServiceCard } from '@/components/settings/sections/OcrServiceCard';
import type { OcrStatus } from '@/types/ocr';

const { getOcrStatusMock, listenToOcrPrepareProgressMock, prepareOcrMock, releaseOcrMock } = vi.hoisted(() => ({
  getOcrStatusMock: vi.fn(),
  listenToOcrPrepareProgressMock: vi.fn(),
  prepareOcrMock: vi.fn(),
  releaseOcrMock: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/lib/ocr', () => ({
  getOcrStatus: getOcrStatusMock,
  listenToOcrPrepareProgress: listenToOcrPrepareProgressMock,
  prepareOcr: prepareOcrMock,
  releaseOcr: releaseOcrMock,
}));

const readyStatus: OcrStatus = {
  activeModel: 'ppocrv5_mobile',
  activeRelease: 'ocr-models-20260414-b7141e7',
  modelDir: 'C:\\Users\\Flynn\\AppData\\Local\\com.ctxrun\\models\\ocr\\packages\\ocr-models-20260414-b7141e7',
  installed: true,
  loaded: false,
  preparing: false,
  missingFiles: [],
  idleTtlSecs: 120,
  idleExpiresInMs: 0,
};

describe('OcrServiceCard', () => {
  beforeEach(() => {
    getOcrStatusMock.mockReset();
    listenToOcrPrepareProgressMock.mockReset();
    prepareOcrMock.mockReset();
    releaseOcrMock.mockReset();
    listenToOcrPrepareProgressMock.mockResolvedValue(vi.fn());
    releaseOcrMock.mockResolvedValue(true);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the resolved OCR status under StrictMode without getting stuck in loading', async () => {
    getOcrStatusMock.mockResolvedValue(readyStatus);

    render(
      <React.StrictMode>
        <OcrServiceCard />
      </React.StrictMode>,
    );

    await waitFor(() => expect(screen.getByText('settings.ocrReady')).toBeTruthy());
    expect(screen.queryByText('settings.ocrStatusLoading')).toBeNull();
    expect(screen.getByText(readyStatus.activeModel)).toBeTruthy();
  });

  it('surfaces a dedicated load failure state when OCR status loading fails', async () => {
    getOcrStatusMock.mockRejectedValue(new Error('status failed'));

    render(<OcrServiceCard />);

    await waitFor(() => expect(screen.getByText('settings.ocrStatusLoadFailed')).toBeTruthy());
    expect(screen.getByText('status failed')).toBeTruthy();
  });
});
