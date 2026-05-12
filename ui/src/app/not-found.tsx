import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Link from 'next/link';
import strings from '@/i18n/strings';

export default function NotFound() {
  return (
    <Box sx={{ textAlign: 'center', py: 8 }}>
      <Typography variant="h4" sx={{ mb: 2 }}>{strings.pageNotFound}</Typography>
      <Button component={Link} href="/" variant="contained">{strings.backToDocuments}</Button>
    </Box>
  );
}
