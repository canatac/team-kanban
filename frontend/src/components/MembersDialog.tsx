import { useState } from 'react';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  InputBase,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { api } from '../api';
import type { ProjectDetail } from '../types';

interface MembersDialogProps {
  open: boolean;
  detail: ProjectDetail;
  onClose: () => void;
  onChanged: () => void;
}

export default function MembersDialog({ open, detail, onClose, onChanged }: MembersDialogProps) {
  const [login, setLogin] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    if (!login.trim()) return;
    try {
      await api.addMember(detail.project.id, login.trim());
      setLogin('');
      setError(null);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async (userId: string) => {
    try {
      await api.removeMember(detail.project.id, userId);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Membres du projet</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 1 }}>
            {error}
          </Alert>
        )}
        <List>
          {detail.members.map((m) => (
            <ListItem
              key={m.id}
              secondaryAction={
                detail.project.owner_id === m.id ? undefined : (
                  <IconButton edge="end" onClick={() => void remove(m.id)} aria-label="Retirer">
                    <DeleteIcon />
                  </IconButton>
                )
              }
            >
              <ListItemAvatar>
                <Avatar src={m.avatar_url ?? undefined}>{m.login.charAt(0).toUpperCase()}</Avatar>
              </ListItemAvatar>
              <ListItemText
                primary={m.login}
                secondary={detail.project.owner_id === m.id ? 'Propriétaire' : undefined}
              />
            </ListItem>
          ))}
        </List>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <InputBase
            placeholder="login GitHub"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void add();
            }}
            sx={{
              border: 1,
              borderColor: 'divider',
              borderRadius: 1,
              px: 1,
              py: 0.5,
              flexGrow: 1,
            }}
          />
          <Button variant="contained" disabled={!login.trim()} onClick={() => void add()}>
            Inviter
          </Button>
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          Le collègue doit s'être connecté au moins une fois avec son compte GitHub.
        </Typography>
      </DialogContent>
    </Dialog>
  );
}
