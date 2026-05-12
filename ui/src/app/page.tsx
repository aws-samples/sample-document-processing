'use client';

import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';
import FileUploader from '@/components/FileUploader';
import DocumentTable from '@/components/DocumentTable';
import { useDocuments } from '@/hooks/useDocuments';
import strings from '@/i18n/strings';

export default function HomePage() {
  const { documents, loading, refresh } = useDocuments();

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      {/* Upload Section */}
      <Typography variant="h5" sx={{ mb: 2 }}>
        {strings.uploadDocument}
      </Typography>
      <FileUploader onUploadComplete={refresh} />

      <Divider sx={{ my: 4 }} />

      {/* Document List Section */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5">{strings.documents}</Typography>
        <Typography variant="body2" color="text.secondary">
          {documents.length} document{documents.length !== 1 ? 's' : ''}
        </Typography>
      </Box>
      <DocumentTable documents={documents} loading={loading} />
    </Container>
  );
}
