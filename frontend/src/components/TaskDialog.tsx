import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Avatar,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  InputBase,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import SendIcon from '@mui/icons-material/Send';
import type { SelectChangeEvent } from '@mui/material/Select';
import { api } from '../api';
import type { ProjectDetail, TaskWithComments } from '../types';

interface TaskDialogProps {
  taskId: string;
  detail: ProjectDetail;
  onClose: () => void;
  onChanged: () => void;
}

export default function TaskDialog({ taskId, detail, onClose, onChanged }: TaskDialogProps) {
  const [data, setData] = useState<TaskWithComments | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api.getTask(taskId);
      setData(d);
      setTitle(d.task.title);
      setDescription(d.task.description ?? '');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateTask = async (patch: {
    column_id?: string;
    position?: number;
    assignee_id?: string | null;
  }) => {
    if (!data) return;
    try {
      await api.updateTask(taskId, {
        title: title.trim() || data.task.title,
        description: description.trim() || null,
        column_id: patch.column_id ?? data.task.column_id,
        position: patch.position ?? data.task.position,
        assignee_id: patch.assignee_id !== undefined ? patch.assignee_id : data.task.assignee_id,
      });
      onChanged();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const changeColumn = (event: SelectChangeEvent) => {
    const columnId = event.target.value;
    const maxPos = Math.max(
      0,
      ...detail.tasks.filter((t) => t.column_id === columnId).map((t) => t.position),
    );
    void updateTask({ column_id: columnId, position: maxPos + 1 });
  };

  const changeAssignee = (event: SelectChangeEvent) => {
    void updateTask({ assignee_id: event.target.value || null });
  };

  const addComment = async () => {
    if (!comment.trim()) return;
    try {
      await api.addComment(taskId, comment.trim());
      setComment('');
      await load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const deleteComment = async (commentId: string) => {
    try {
      await api.deleteComment(commentId);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const deleteTask = async () => {
    try {
      await api.deleteTask(taskId);
      onChanged();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
        <Box sx={{ flexGrow: 1, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Select
            size="small"
            value={data?.task.column_id ?? ''}
            onChange={changeColumn}
            sx={{ minWidth: 130 }}
          >
            {detail.columns.map((c) => (
              <MenuItem key={c.id} value={c.id}>
                {c.name}
              </MenuItem>
            ))}
          </Select>
          <Select
            size="small"
            value={data?.task.assignee_id ?? ''}
            onChange={changeAssignee}
            sx={{ minWidth: 130 }}
            renderValue={(value) =>
              value ? (detail.members.find((m) => m.id === value)?.login ?? '') : 'Non assignée'
            }
          >
            <MenuItem value="">
              <em>Non assignée</em>
            </MenuItem>
            {detail.members.map((m) => (
              <MenuItem key={m.id} value={m.id}>
                {m.login}
              </MenuItem>
            ))}
          </Select>
        </Box>
        <IconButton onClick={() => void deleteTask()} color="error" aria-label="Supprimer la tâche">
          <DeleteIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {!data ? (
          <CircularProgress />
        ) : (
          <>
            <TextField
              fullWidth
              multiline
              label="Titre"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              multiline
              minRows={2}
              label="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              sx={{ mb: 2 }}
            />
            <Button variant="contained" onClick={() => void updateTask({})}>
              Enregistrer
            </Button>
            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Commentaires
            </Typography>
            <List>
              {data.comments.map((c) => (
                <ListItem
                  key={c.id}
                  secondaryAction={
                    <IconButton edge="end" onClick={() => void deleteComment(c.id)}>
                      <DeleteIcon />
                    </IconButton>
                  }
                >
                  <ListItemAvatar>
                    <Avatar src={c.author_avatar ?? undefined}>
                      {c.author_login.charAt(0).toUpperCase()}
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText
                    primary={c.body}
                    secondary={`${c.author_login} · ${new Date(c.created_at).toLocaleString('fr-FR')}`}
                  />
                </ListItem>
              ))}
              {data.comments.length === 0 && (
                <Typography color="text.secondary">Aucun commentaire.</Typography>
              )}
            </List>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <InputBase
                placeholder="Écrire un commentaire…"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void addComment();
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
              <IconButton onClick={() => void addComment()} disabled={!comment.trim()}>
                <SendIcon />
              </IconButton>
            </Box>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Fermer</Button>
      </DialogActions>
    </Dialog>
  );
}
