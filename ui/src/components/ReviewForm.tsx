'use client';

import { useState } from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TablePagination from '@mui/material/TablePagination';
import Paper from '@mui/material/Paper';
import Divider from '@mui/material/Divider';
import strings from '@/i18n/strings';

interface ReviewFormProps {
  extractedData: Record<string, unknown>;
  readOnly?: boolean;
  onChange?: (data: Record<string, unknown>) => void;
}

function isScalar(value: unknown): value is string | number | boolean | null | undefined {
  return value === null || value === undefined || typeof value !== 'object';
}

function isFlatObjectArray(value: unknown): value is Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  if (typeof value[0] !== 'object' || value[0] === null) return false;
  return Object.values(value[0]).every(isScalar);
}

function isObjectArray(value: unknown): value is Record<string, unknown>[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    typeof value[0] === 'object' &&
    value[0] !== null
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatLabel(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const HIDDEN_FIELDS = new Set(['sourcePages', 'duns', 'taxId']);

/** Paginated table for flat arrays of objects (e.g. lineItems) */
function PaginatedTable({ rows, readOnly, label }: { rows: Record<string, unknown>[]; readOnly: boolean; label: string }) {
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  const paginatedRows = rows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  return (
    <Box>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
        {label} ({rows.length})
      </Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              {columns.map((col) => (
                <TableCell key={col} sx={{ fontWeight: 600 }}>
                  {formatLabel(col)}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {paginatedRows.map((row, i) => (
              <TableRow key={page * rowsPerPage + i}>
                {columns.map((col) => (
                  <TableCell key={col}>{String(row[col] ?? '')}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TablePagination
          component="div"
          count={rows.length}
          page={page}
          onPageChange={(_, p) => setPage(p)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
          rowsPerPageOptions={[5, 10, 25]}
        />
      </TableContainer>
    </Box>
  );
}

/** Render scalar fields as a grid of TextFields */
function ScalarFieldGrid({ entries, readOnly }: { entries: [string, unknown][]; readOnly: boolean }) {
  if (entries.length === 0) return null;
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
      {entries.map(([key, value]) => (
        <TextField
          key={key}
          label={formatLabel(key)}
          value={value ?? ''}
          size="small"
          fullWidth
          disabled={readOnly}
          slotProps={{ inputLabel: { shrink: true } }}
        />
      ))}
    </Box>
  );
}

/** Recursively render a data section (without line items — those are handled separately) */
function DataSection({
  data,
  readOnly,
  depth = 0,
  skipKeys = new Set<string>(),
}: {
  data: Record<string, unknown>;
  readOnly: boolean;
  depth?: number;
  skipKeys?: Set<string>;
}) {
  const entries = Object.entries(data).filter(([key]) => !HIDDEN_FIELDS.has(key) && !skipKeys.has(key));
  const scalarEntries = entries.filter(([, v]) => isScalar(v));
  const objectEntries = entries.filter(([, v]) => isPlainObject(v));
  const flatArrayEntries = entries.filter(([, v]) => isFlatObjectArray(v));
  const nestedArrayEntries = entries.filter(
    ([, v]) => isObjectArray(v) && !isFlatObjectArray(v)
  );
  const scalarArrayEntries = entries.filter(
    ([, v]) => Array.isArray(v) && !isObjectArray(v)
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      <ScalarFieldGrid
        entries={[...scalarEntries, ...scalarArrayEntries.map(([k, v]) => [k, Array.isArray(v) ? (v as unknown[]).join(', ') : v] as [string, unknown])]}
        readOnly={readOnly}
      />

      {objectEntries.map(([key, value]) => (
        <Box key={key}>
          <Typography variant={depth === 0 ? 'subtitle1' : 'subtitle2'} sx={{ fontWeight: 600, mb: 1 }}>
            {formatLabel(key)}
          </Typography>
          <Box sx={{ pl: 2, borderLeft: '2px solid', borderColor: 'divider' }}>
            <DataSection data={value as Record<string, unknown>} readOnly={readOnly} depth={depth + 1} />
          </Box>
        </Box>
      ))}

      {flatArrayEntries.map(([key, items]) => (
        <PaginatedTable key={key} rows={items as Record<string, unknown>[]} readOnly={readOnly} label={formatLabel(key)} />
      ))}

      {nestedArrayEntries.map(([key, items]) => {
        const arr = items as Record<string, unknown>[];
        if (arr.length === 1) {
          return (
            <Box key={key}>
              <Divider sx={{ my: 1 }} />
              <Typography variant={depth === 0 ? 'h6' : 'subtitle1'} sx={{ fontWeight: 600, mb: 1 }}>
                {formatLabel(key)}
              </Typography>
              <DataSection data={arr[0]} readOnly={readOnly} depth={depth + 1} />
            </Box>
          );
        }
        return (
          <Box key={key}>
            <Divider sx={{ my: 1 }} />
            <Typography variant={depth === 0 ? 'h6' : 'subtitle1'} sx={{ fontWeight: 600, mb: 1 }}>
              {formatLabel(key)}
            </Typography>
            {arr.map((item, i) => (
              <Box key={i} sx={{ mb: 2 }}>
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                  {formatLabel(key)} #{i + 1}
                </Typography>
                <Box sx={{ pl: 2, borderLeft: '2px solid', borderColor: 'divider' }}>
                  <DataSection data={item} readOnly={readOnly} depth={depth + 1} />
                </Box>
              </Box>
            ))}
          </Box>
        );
      })}
    </Box>
  );
}

/** Invoice card with pagination for multiple invoices and paginated line items */
function InvoiceSection({ data, readOnly }: { data: Record<string, unknown>; readOnly: boolean }) {
  // Separate line items from other invoice fields
  const lineItems = isFlatObjectArray(data.lineItems)
    ? (data.lineItems as Record<string, unknown>[])
    : isObjectArray(data.lineItems)
    ? (data.lineItems as Record<string, unknown>[])
    : null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      <DataSection data={data} readOnly={readOnly} skipKeys={new Set(['lineItems'])} />
      {lineItems && (
        <PaginatedTable rows={lineItems} readOnly={readOnly} label="Line Items" />
      )}
    </Box>
  );
}

export default function ReviewForm({ extractedData, readOnly = false }: ReviewFormProps) {
  const [invoicePage, setInvoicePage] = useState(0);

  const vendor = isPlainObject(extractedData.vendor) ? (extractedData.vendor as Record<string, unknown>) : null;

  // Check if there's an invoices array (multiple invoices)
  const invoicesArray = isObjectArray(extractedData.invoices)
    ? (extractedData.invoices as Record<string, unknown>[])
    : null;

  // Everything except vendor and invoices (if array) is "invoice details"
  const invoiceData = Object.fromEntries(
    Object.entries(extractedData).filter(([key]) => key !== 'vendor' && key !== 'invoices')
  );

  const hasInvoiceData = Object.keys(invoiceData).length > 0;
  const totalInvoices = invoicesArray ? invoicesArray.length : hasInvoiceData ? 1 : 0;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Vendor Card */}
      {vendor && (
        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" sx={{ fontWeight: 600, mb: 2, color: 'primary.main' }}>
              {strings.vendorInformation}
            </Typography>
            <DataSection data={vendor} readOnly={readOnly} />
          </CardContent>
        </Card>
      )}

      {/* Invoices Card */}
      {invoicesArray ? (
        <Card variant="outlined">
          <CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                {strings.invoicePrefix}{invoicePage + 1} of {invoicesArray.length}
              </Typography>
            </Box>
            <InvoiceSection data={invoicesArray[invoicePage]} readOnly={readOnly} />
            {invoicesArray.length > 1 && (
              <TablePagination
                component="div"
                count={invoicesArray.length}
                page={invoicePage}
                onPageChange={(_, p) => setInvoicePage(p)}
                rowsPerPage={1}
                onRowsPerPageChange={() => {}}
                rowsPerPageOptions={[]}
                labelDisplayedRows={({ from, count }) => `Invoice ${from} of ${count}`}
              />
            )}
          </CardContent>
        </Card>
      ) : hasInvoiceData ? (
        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
              {strings.invoiceDetails}
            </Typography>
            <InvoiceSection data={invoiceData} readOnly={readOnly} />
          </CardContent>
        </Card>
      ) : null}
    </Box>
  );
}
