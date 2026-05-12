'use client';

import { useCallback, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import LinearProgress from '@mui/material/LinearProgress';
import Paper from '@mui/material/Paper';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import strings from '@/i18n/strings';

const CUSTOMERS = [
  'Pinnacle Financial Group',
  'Redwood Manufacturing Co.',
  'Horizon Healthcare Systems',
  'Atlas Global Logistics',
  'Crestview Energy Partners',
];
import { getPresignedUrl, uploadFileToS3, startWorkflow } from '@/services/api';

interface FileUploaderProps {
  onUploadComplete?: () => void;
}

export default function FileUploader({ onUploadComplete }: FileUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = (f: File) => {
    if (f.type !== 'application/pdf') {
      setError(strings.pdfOnlyError);
      return;
    }
    setFile(f);
    setError(null);
    setSuccess(false);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) handleFile(droppedFile);
  }, []);

  const handleUpload = async () => {
    if (!file || !customerName) {
      setError(strings.fileAndCustomerRequired);
      return;
    }

    setUploading(true);
    setError(null);
    setSuccess(false);

    try {
      const { uploadUrl, documentId } = await getPresignedUrl(file.name, customerName, '');
      await uploadFileToS3(uploadUrl, file);
      await startWorkflow({
        documentId,
        customerName,
        userName: '',
        customFields: [
          { fieldKey: 'invoice_number', fieldType: 'string', description: 'Invoice number' },
          { fieldKey: 'vendor_name', fieldType: 'string', description: 'Vendor name' },
          { fieldKey: 'total_amount', fieldType: 'number', description: 'Total amount' },
          { fieldKey: 'invoice_date', fieldType: 'string', description: 'Invoice date' },
        ],
        schemaType: 'invoice',
      });

      setSuccess(true);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      onUploadComplete?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Box>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(false)}>
          {strings.uploadSuccess}
        </Alert>
      )}

      <Paper
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        sx={{
          p: 4,
          textAlign: 'center',
          cursor: 'pointer',
          backgroundColor: dragOver ? 'action.hover' : 'background.paper',
          borderStyle: 'dashed',
          borderWidth: 2,
          borderColor: dragOver ? 'primary.main' : 'divider',
          transition: 'all 0.2s',
          '&:hover': { borderColor: 'primary.main', backgroundColor: 'action.hover' },
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
        <CloudUploadIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
        <Typography variant="body1" color="text.secondary">
          {file ? file.name : strings.dropZoneText}
        </Typography>
        {file && (
          <Typography variant="caption" color="text.secondary">
            {(file.size / 1024 / 1024).toFixed(2)} MB
          </Typography>
        )}
      </Paper>

      <TextField
        select
        label={strings.customerLabel}
        value={customerName}
        onChange={(e) => setCustomerName(e.target.value)}
        size="small"
        sx={{ mt: 2, minWidth: 280 }}
      >
        {CUSTOMERS.map((name) => (
          <MenuItem key={name} value={name}>
            {name}
          </MenuItem>
        ))}
      </TextField>

      {uploading && <LinearProgress sx={{ mt: 2 }} />}

      <Button
        variant="contained"
        onClick={handleUpload}
        disabled={!file || !customerName || uploading}
        sx={{ mt: 2 }}
        startIcon={<CloudUploadIcon />}
      >
        {uploading ? strings.uploading : strings.uploadAndProcess}
      </Button>
    </Box>
  );
}
