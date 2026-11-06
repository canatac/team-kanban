import { createTheme } from '@mui/material';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#24292e' },
    secondary: { main: '#2ea44f' },
    background: { default: '#f6f8fa' },
  },
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
  },
});

export default theme;
