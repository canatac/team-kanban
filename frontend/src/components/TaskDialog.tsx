import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  InputBase,
  Link,
  List,
  ListItem,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  MenuItem,
  Select,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import CallSplitIcon from '@mui/icons-material/CallSplit';
import DeleteIcon from '@mui/icons-material/Delete';
import SendIcon from '@mui/icons-material/Send';
import type { SelectChangeEvent } from '@mui/material/Select';
import { api } from '../api';
import { fmtCost, fmtTokens, TYPE_COLORS, TYPE_LABELS } from '../format';
import type { ProjectDetail, TaskWithComments } from '../types';

interface TaskDialogProps {
  taskId: string;
  detail: ProjectDetail;
  onClose: () => void;
  onChanged: () => void;
  onOpenTask: (id: string) => void;
}

/** Petit bloc de liste à puces (Résultats attendus, DoD…). */
function Section({ title, items }: { title: string; items: string[] }) {
  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="subtitle2" color="primary">
        {title}
      </Typography>
      <List dense disablePadding>
        {items.map((item, i) => (
          <ListItem key={i} disableGutters sx={{ display: 'list-item', pl: 2 }}>
            <ListItemText primary={item} />
          </ListItem>
        ))}
      </List>
    </Box>
  );
}

export default function TaskDialog({ taskId, detail, onClose, onChanged, onOpenTask }: TaskDialogProps) {
  const [data, setData] = useState<TaskWithComments | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState<'scrum' | 'split' | null>(null);
  const [scrumInfo, setScrumInfo] = useState<{ recommend: boolean; reason: string } | null>(null);

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
    setScrumInfo(null);
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

  const generateScrum = async () => {
    setAiBusy('scrum');
    setError(null);
    try {
      const result = await api.scrumTask(taskId);
      setScrumInfo({
        recommend: result.split_recommendation,
        reason: result.split_reason,
      });
      onChanged();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAiBusy(null);
    }
  };

  const splitTask = async () => {
    setAiBusy('split');
    setError(null);
    try {
      const result = await api.splitTask(taskId);
      setScrumInfo(null);
      onChanged();
      await load();
      if (result.created.length > 0) {
        setScrumInfo({
          recommend: false,
          reason: `${result.created.length} sous-tickets créés et rattachés à ce ticket.`,
        });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAiBusy(null);
    }
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

  const children = detail.tasks.filter((t) => t.parent_task_id === taskId);
  const parent = data?.task.parent_task_id
    ? detail.tasks.find((t) => t.id === data.task.parent_task_id)
    : undefined;
  const t = data?.task;

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
        <Box sx={{ flexGrow: 1, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {t && (
            <Chip
              size="small"
              label={TYPE_LABELS[t.task_type]}
              color={TYPE_COLORS[t.task_type]}
              variant="outlined"
            />
          )}
          {t?.story_points != null && (
            <Chip size="small" label={`${t.story_points} story points`} variant="outlined" />
          )}
          {t && (
            <Tooltip
              title={`Consommation IA de ce ticket : ${fmtTokens(
                data!.ai_usage.prompt_tokens,
              )} tokens envoyés, ${fmtTokens(
                data!.ai_usage.completion_tokens,
              )} tokens reçus, coût ${fmtCost(data!.ai_usage.cost_eur)}.`}
            >
              <Chip
                size="small"
                icon={<AutoAwesomeIcon />}
                label={`IA · ${fmtTokens(data!.ai_usage.prompt_tokens)} ↑ · ${fmtTokens(
                  data!.ai_usage.completion_tokens,
                )} ↓ · ${fmtCost(data!.ai_usage.cost_eur)}`}
                sx={{
                  bgcolor: 'grey.100',
                  '& .MuiChip-icon': { color: 'primary.main' },
                  fontWeight: 500,
                }}
              />
            </Tooltip>
          )}
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
        {scrumInfo?.recommend && (
          <Alert
            severity="info"
            icon={<CallSplitIcon />}
            sx={{ mb: 2 }}
            action={
              <Button
                size="small"
                startIcon={aiBusy === 'split' ? <CircularProgress size={14} /> : <CallSplitIcon />}
                disabled={aiBusy !== null}
                onClick={() => void splitTask()}
              >
                Découper
              </Button>
            }
          >
            L'IA recommande de découper ce ticket : {scrumInfo.reason || 'périmètre trop large'}
          </Alert>
        )}
        {scrumInfo && !scrumInfo.recommend && scrumInfo.reason && (
          <Alert severity="success" sx={{ mb: 2 }}>
            {scrumInfo.reason}
          </Alert>
        )}
        {!data ? (
          <CircularProgress />
        ) : (
          <>
            <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
              <Button
                variant="contained"
                onClick={() => void updateTask({})}
                disabled={aiBusy !== null}
              >
                Enregistrer
              </Button>
              <Button
                variant="outlined"
                startIcon={
                  aiBusy === 'scrum' ? (
                    <CircularProgress size={16} />
                  ) : (
                    <AutoAwesomeIcon />
                  )
                }
                onClick={() => void generateScrum()}
                disabled={aiBusy !== null}
              >
                Fiche Scrum (IA)
              </Button>
              <Button
                variant="outlined"
                color="secondary"
                startIcon={
                  aiBusy === 'split' ? <CircularProgress size={16} /> : <CallSplitIcon />
                }
                onClick={() => void splitTask()}
                disabled={aiBusy !== null}
              >
                Découper (IA)
              </Button>
            </Box>
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

            {parent && (
              <Typography variant="body2" sx={{ mb: 1 }}>
                Ticket parent :{' '}
                <Link
                  component="button"
                  onClick={() => onOpenTask(parent.id)}
                  sx={{ verticalAlign: 'baseline' }}
                >
                  {parent.title}
                </Link>
              </Typography>
            )}

            {/* Fiche Scrum générée par IA */}
            {(t.user_story || t.context || t.technical_notes) && (
              <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 2, mt: 1 }}>
                <Typography variant="subtitle1">Fiche Scrum</Typography>
                {t.user_story && (
                  <Typography variant="body2" sx={{ fontStyle: 'italic', mt: 1 }}>
                    {t.user_story}
                  </Typography>
                )}
                {t.context && (
                  <Box sx={{ mt: 2 }}>
                    <Typography variant="subtitle2" color="primary">
                      Contexte
                    </Typography>
                    <Typography variant="body2">{t.context}</Typography>
                  </Box>
                )}
                {t.expected_results.length > 0 && (
                  <Section title="Résultats attendus" items={t.expected_results} />
                )}
                {t.acceptance_criteria.length > 0 && (
                  <Section title="Critères d'acceptation" items={t.acceptance_criteria} />
                )}
                {t.definition_of_done.length > 0 && (
                  <Section title="Definition of Done" items={t.definition_of_done} />
                )}
                {t.technical_notes && (
                  <Box sx={{ mt: 2 }}>
                    <Typography variant="subtitle2" color="primary">
                      Notes techniques
                    </Typography>
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                      {t.technical_notes}
                    </Typography>
                  </Box>
                )}
              </Box>
            )}

            {/* Sous-tickets rattachés */}
            {children.length > 0 && (
              <Box sx={{ mt: 2 }}>
                <Divider sx={{ mb: 1 }} />
                <Typography variant="subtitle2" color="primary">
                  Sous-tickets ({children.length})
                </Typography>
                <List dense>
                  {children.map((child) => (
                    <ListItemButton key={child.id} onClick={() => onOpenTask(child.id)}>
                      <ListItemText
                        primary={child.title}
                        secondary={`${TYPE_LABELS[child.task_type]}${
                          child.story_points != null ? ` · ${child.story_points} pts` : ''
                        }`}
                      />
                    </ListItemButton>
                  ))}
                </List>
              </Box>
            )}

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
