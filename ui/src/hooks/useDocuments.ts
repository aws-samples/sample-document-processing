'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { listDocuments } from '@/services/api';
import type { DocumentRecord } from '@/services/types';

const POLL_INTERVAL_MS = 10_000;

export function useDocuments() {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const docs = await listDocuments();
      setDocuments(docs);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll when any document is actively processing
  useEffect(() => {
    const hasActive = documents.some((d) => d.status === 'Queued' || d.status === 'Processing');
    if (hasActive) {
      timerRef.current = setInterval(refresh, POLL_INTERVAL_MS);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [documents, refresh]);

  return { documents, loading, error, refresh };
}
