'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Box from '@mui/material/Box';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TableSortLabel from '@mui/material/TableSortLabel';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import InputAdornment from '@mui/material/InputAdornment';
import Tooltip from '@mui/material/Tooltip';
import SearchIcon from '@mui/icons-material/Search';
import StatusChip from './StatusChip';
import type { DocumentRecord } from '@/services/types';
import strings from '@/i18n/strings';

type SortKey = 'documentName' | 'customerName' | 'status' | 'createdAt' | 'updatedAt';
type SortDir = 'asc' | 'desc';

interface DocumentTableProps {
  documents: DocumentRecord[];
  loading?: boolean;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function DocumentTable({ documents, loading }: DocumentTableProps) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let rows = documents;
    if (q) {
      rows = rows.filter(
        (d) =>
          d.documentName.toLowerCase().includes(q) ||
          d.customerName.toLowerCase().includes(q) ||
          d.status.toLowerCase().includes(q)
      );
    }
    rows = [...rows].sort((a, b) => {
      const aVal = a[sortKey] ?? '';
      const bVal = b[sortKey] ?? '';
      const cmp = String(aVal).localeCompare(String(bVal));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [documents, search, sortKey, sortDir]);

  const columns: { key: SortKey; label: string }[] = [
    { key: 'documentName', label: strings.columnDocument },
    { key: 'customerName', label: strings.columnCustomer },
    { key: 'status', label: strings.columnStatus },
    { key: 'createdAt', label: strings.columnCreated },
    { key: 'updatedAt', label: strings.columnUpdated },
  ];

  return (
    <Box>
      <TextField
        placeholder={strings.searchPlaceholder}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        size="small"
        fullWidth
        sx={{ mb: 2 }}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          },
        }}
      />

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      ) : filtered.length === 0 ? (
        <Typography color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
          {strings.noDocumentsFound}
        </Typography>
      ) : (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                {columns.map((col) => (
                  <TableCell key={col.key}>
                    <TableSortLabel
                      active={sortKey === col.key}
                      direction={sortKey === col.key ? sortDir : 'asc'}
                      onClick={() => handleSort(col.key)}
                    >
                      {col.label}
                    </TableSortLabel>
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map((doc) => (
                <TableRow
                  key={doc.id}
                  hover
                  sx={{ cursor: 'pointer' }}
                  onClick={() => router.push(`/review/?id=${doc.id}`)}
                >
                  <TableCell>{doc.documentName}</TableCell>
                  <TableCell>{doc.customerName}</TableCell>
                  <TableCell>
                    {doc.errorMessage ? (
                      <Tooltip title={doc.errorMessage} arrow>
                        <span><StatusChip status={doc.status} /></span>
                      </Tooltip>
                    ) : (
                      <StatusChip status={doc.status} />
                    )}
                  </TableCell>
                  <TableCell>{formatDate(doc.createdAt)}</TableCell>
                  <TableCell>{formatDate(doc.updatedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}
