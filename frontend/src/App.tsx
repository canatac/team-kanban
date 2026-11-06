import { useState } from 'react';
import { AppBar, Avatar, Box, Chip, CircularProgress, IconButton, Toolbar, Typography } from '@mui/material';
import LogoutIcon from '@mui/icons-material/Logout';
import { useAuth } from './auth';
import Board from './components/Board';
import Login from './components/Login';
import ProjectsList from './components/ProjectsList';

export default function App() {
  const { user, loading, setUser } = useAuth();
  const [projectId, setProjectId] = useState<string | null>(null);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 10 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (!user) return <Login />;

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } catch {
      /* on se déconnecte quand même */
    }
    setUser(null);
    window.location.href = '/';
  };

  return (
    <Box>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            Team Kanban
          </Typography>
          <Chip
            sx={{ mr: 1 }}
            avatar={
              <Avatar src={user.avatar_url ?? undefined}>
                {user.login.charAt(0).toUpperCase()}
              </Avatar>
            }
            label={user.login}
          />
          <IconButton color="inherit" onClick={() => void logout()} aria-label="Déconnexion">
            <LogoutIcon />
          </IconButton>
        </Toolbar>
      </AppBar>
      {projectId ? (
        <Board projectId={projectId} onBack={() => setProjectId(null)} />
      ) : (
        <ProjectsList onSelect={setProjectId} />
      )}
    </Box>
  );
}
