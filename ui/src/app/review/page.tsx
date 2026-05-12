'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import Link from '@mui/material/Link';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import NextLink from 'next/link';
import StatusChip from '@/components/StatusChip';
import ReviewForm from '@/components/ReviewForm';
import { getDocument, updateDocumentStatus } from '@/services/api';
import type { DocumentRecord } from '@/services/types';
import strings from '@/i18n/strings';

function ReviewPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = searchParams?.get('id') ?? '';

  const [doc, setDoc] = useState<DocumentRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (!id) {
      setError('No document ID provided');
      setLoading(false);
      return;
    }
    getDocument(id)
      .then(setDoc)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  const handleStatusUpdate = async (status: 'Approved' | 'Rejected') => {
    setUpdating(true);
    try {
      const updated = await updateDocumentStatus(id, status);
      setDoc(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status');
    } finally {
      setUpdating(false);
    }
  };

  if (loading) {
    return (
      <Container maxWidth="lg" sx={{ py: 4, textAlign: 'center' }}>
        <CircularProgress />
      </Container>
    );
  }

  if (error || !doc) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert severity="error">{error || 'Document not found'}</Alert>
        <Button startIcon={<ArrowBackIcon />} onClick={() => router.push('/')} sx={{ mt: 2 }}>
          {strings.backToDocuments}
        </Button>
      </Container>
    );
  }

  const canReview = doc.status === 'In Review';

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Breadcrumbs sx={{ mb: 2 }}>
        <Link component={NextLink} href="/" underline="hover" color="inherit">
          {strings.documents}
        </Link>
        <Typography color="text.primary">{doc.documentName}</Typography>
      </Breadcrumbs>

      {/* Document header */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Box>
            <Typography variant="h5" sx={{ mb: 1 }}>
              {doc.documentName}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {strings.customerPrefix}{doc.customerName} &middot; User: {doc.userName}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {strings.createdPrefix}{new Date(doc.createdAt).toLocaleString()} &middot; Updated:{' '}
              {new Date(doc.updatedAt).toLocaleString()}
            </Typography>
          </Box>
          <StatusChip status={doc.status} />
        </Box>
      </Paper>

      {/* Error message for failed documents */}
      {(doc.status === 'Failed' || doc.status === 'Malware Detected') && doc.errorMessage && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {doc.errorMessage}
        </Alert>
      )}

      {/* Extracted data */}
      {doc.extractedData ? (
        <Box sx={{ mb: 3 }}>
          <ReviewForm extractedData={doc.extractedData} readOnly={!canReview} />
        </Box>
      ) : (
        <Paper sx={{ p: 3, mb: 3 }}>
          <Typography color="text.secondary" sx={{ textAlign: 'center', py: 2 }}>
            {doc.status === 'Queued' || doc.status === 'Processing'
              ? 'Document is being processed...'
              : doc.status === 'Failed' || doc.status === 'Malware Detected'
              ? 'Processing did not complete successfully.'
              : 'No extracted data available.'}
          </Typography>
          {(doc.status === 'Queued' || doc.status === 'Processing') && (
            <Box sx={{ display: 'flex', justifyContent: 'center' }}>
              <CircularProgress size={24} />
            </Box>
          )}
        </Paper>
      )}

      {/* Action buttons */}
      <Box sx={{ display: 'flex', gap: 2 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => router.push('/')}>
          {strings.back}
        </Button>

        {canReview && (
          <>
            <Box sx={{ flex: 1 }} />
            <Button
              variant="outlined"
              color="error"
              startIcon={<CancelIcon />}
              onClick={() => handleStatusUpdate('Rejected')}
              disabled={updating}
            >
              {strings.reject}
            </Button>
            <Button
              variant="contained"
              color="success"
              startIcon={<CheckCircleIcon />}
              onClick={() => handleStatusUpdate('Approved')}
              disabled={updating}
            >
              {strings.approve}
            </Button>
          </>
        )}
      </Box>
    </Container>
  );
}

export default function ReviewPage() {
  return (
    <Suspense
      fallback={
        <Container maxWidth="lg" sx={{ py: 4, textAlign: 'center' }}>
          <CircularProgress />
        </Container>
      }
    >
      <ReviewPageContent />
    </Suspense>
  );
}
