'use client';

import Chip from '@mui/material/Chip';
import type { DocumentStatus } from '@/services/types';

const STATUS_CONFIG: Record<DocumentStatus, { color: 'default' | 'info' | 'warning' | 'success' | 'error'; label: string }> = {
  Queued: { color: 'default', label: 'Queued' },
  Processing: { color: 'info', label: 'Processing' },
  'In Review': { color: 'warning', label: 'In Review' },
  Approved: { color: 'success', label: 'Approved' },
  Rejected: { color: 'error', label: 'Rejected' },
  Failed: { color: 'error', label: 'Failed' },
  'Malware Detected': { color: 'error', label: 'Malware Detected' },
};

interface StatusChipProps {
  status: DocumentStatus;
}

export default function StatusChip({ status }: StatusChipProps) {
  const config = STATUS_CONFIG[status] ?? { color: 'default' as const, label: status };
  return <Chip label={config.label} color={config.color} size="small" />;
}
