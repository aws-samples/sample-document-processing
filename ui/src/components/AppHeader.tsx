'use client';

import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import DescriptionIcon from '@mui/icons-material/Description';
import Link from 'next/link';
import strings from '@/i18n/strings';

export default function AppHeader() {
  return (
    <AppBar position="static" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider' }}>
      <Toolbar>
        <Link href="/" style={{ display: 'flex', alignItems: 'center', textDecoration: 'none', color: 'inherit' }}>
          <DescriptionIcon sx={{ mr: 1 }} />
          <Typography variant="h6" component="span" sx={{ fontWeight: 700 }}>
            {strings.appName}
          </Typography>
        </Link>
        <Box sx={{ ml: 2 }}>
          <Typography variant="body2" sx={{ opacity: 0.8 }}>
            {strings.appSubtitle}
          </Typography>
        </Box>
      </Toolbar>
    </AppBar>
  );
}
