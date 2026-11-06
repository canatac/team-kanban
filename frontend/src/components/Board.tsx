import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import GroupIcon from '@mui/icons-material/Group';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import {
  DndContext,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from '@dnd-kit/core';
import { api } from '../api';
import { fmtCost, fmtTokens, TYPE_COLORS, TYPE_LABELS } from '../format';
import { useProjectSocket } from '../hooks/useProjectSocket';
import type { Column, ProjectDetail, Task, UserLite } from '../types';
import AiDialog from './AiDialog';
import MembersDialog from './MembersDialog';
import Roadmap, { PriorityChip } from './Roadmap';
import TaskDialog from './TaskDialog';

export default function Board({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [addTaskColumn, setAddTaskColumn] = useState<Column | null>(null);
  const [addColumnOpen, setAddColumnOpen] = useState(false);
  const [renameColumn, setRenameColumn] = useState<Column | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newColumnName, setNewColumnName] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const [aiOpen, setAiOpen] = useState(false);
  const [view, setView] = useState<'board' | 'roadmap'>('board');

  const load = useCallback(async () => {
    try {
      setDetail(await api.getProject(projectId));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Temps réel : à chaque événement WebSocket, on recharge le projet (débounce 250 ms).
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);
  const timerRef = useRef<number | undefined>(undefined);
  useProjectSocket(projectId, () => {
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void loadRef.current(), 250);
  });

  const onDragEnd = (event: DragEndEvent) => {
    if (!event.over || !detail) return;
    const taskId = String(event.active.id);
    const columnId = String(event.over.id);
    const task = detail.tasks.find((t) => t.id === taskId);
    if (!task || task.column_id === columnId) return;
    const maxPos = Math.max(
      0,
      ...detail.tasks.filter((t) => t.column_id === columnId).map((t) => t.position),
    );
    api
      .updateTask(taskId, {
        title: task.title,
        description: task.description,
        column_id: columnId,
        position: maxPos + 1,
        assignee_id: task.assignee_id,
      })
      .then(() => loadRef.current())
      .catch((e) => setError((e as Error).message));
  };

  const addTask = async () => {
    if (!addTaskColumn || !newTaskTitle.trim()) return;
    try {
      await api.createTask(projectId, addTaskColumn.id, newTaskTitle.trim());
      setNewTaskTitle('');
      setAddTaskColumn(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const addColumn = async () => {
    if (!newColumnName.trim()) return;
    try {
      await api.createColumn(projectId, newColumnName.trim());
      setNewColumnName('');
      setAddColumnOpen(false);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const renameCol = async () => {
    if (!renameColumn || !renameValue.trim()) return;
    try {
      await api.renameColumn(renameColumn.id, renameValue.trim());
      setRenameColumn(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!detail) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
        {error ? (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : (
          <CircularProgress />
        )}
      </Box>
    );
  }

  // Nombre de sous-tickets rattachés à chaque ticket (pour les cartes).
  const childCounts = new Map<string, number>();
  for (const t of detail.tasks) {
    if (t.parent_task_id) {
      childCounts.set(t.parent_task_id, (childCounts.get(t.parent_task_id) ?? 0) + 1);
    }
  }

  return (
    <Box>
      <Toolbar>
        <IconButton edge="start" onClick={onBack} sx={{ mr: 1 }} aria-label="Retour aux projets">
          <ArrowBackIcon />
        </IconButton>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexGrow: 1, minWidth: 0 }}>
          <Typography variant="h5" noWrap>
            {detail.project.name}
          </Typography>
          <Tooltip
            title={`IA Mistral — depuis le début du projet : ${fmtTokens(
              detail.ai_usage.prompt_tokens,
            )} tokens envoyés, ${fmtTokens(
              detail.ai_usage.completion_tokens,
            )} tokens reçus, coût ${fmtCost(detail.ai_usage.cost_eur)}.`}
          >
            <Chip
              size="small"
              icon={<AutoAwesomeIcon />}
              label={`${fmtTokens(detail.ai_usage.prompt_tokens)} ↑ · ${fmtTokens(
                detail.ai_usage.completion_tokens,
              )} ↓ · ${fmtCost(detail.ai_usage.cost_eur)}`}
              sx={{
                bgcolor: 'grey.100',
                '& .MuiChip-icon': { color: 'primary.main' },
                fontWeight: 500,
              }}
            />
          </Tooltip>
        </Box>
        <ToggleButtonGroup<'board' | 'roadmap'>
          size="small"
          exclusive
          value={view}
          onChange={(_, v) => {
            if (v !== null) setView(v);
          }}
          sx={{ ml: 1 }}
        >
          <ToggleButton value="board" aria-label="Vue tableau" title="Tableau kanban">
            Kanban
          </ToggleButton>
          <ToggleButton value="roadmap" aria-label="Vue roadmap" title="Roadmap par priorité métier">
            Roadmap
          </ToggleButton>
        </ToggleButtonGroup>
        <Button startIcon={<GroupIcon />} onClick={() => setMembersOpen(true)}>
          Membres ({detail.members.length})
        </Button>
        <Button
          startIcon={<AutoAwesomeIcon />}
          variant="outlined"
          onClick={() => setAiOpen(true)}
          sx={{ ml: 1 }}
        >
          Générer avec l'IA
        </Button>
      </Toolbar>
      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mx: 2, mb: 1 }}>
          {error}
        </Alert>
      )}
      {view === 'board' ? (
        <DndContext onDragEnd={onDragEnd}>
        <Box sx={{ display: 'flex', gap: 2, overflowX: 'auto', p: 2, alignItems: 'flex-start' }}>
          {detail.columns.map((column) => (
            <ColumnView
              key={column.id}
              column={column}
              tasks={detail.tasks.filter((t) => t.column_id === column.id)}
              childCounts={childCounts}
              members={detail.members}
              onOpenTask={setOpenTaskId}
              onAddTask={setAddTaskColumn}
              onRename={(c) => {
                setRenameColumn(c);
                setRenameValue(c.name);
              }}
              onDelete={async (c) => {
                try {
                  await api.deleteColumn(c.id);
                  await load();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            />
          ))}
          <Paper
            sx={{
              p: 2,
              width: 280,
              flexShrink: 0,
              border: '1px dashed',
              borderColor: 'divider',
              bgcolor: 'transparent',
            }}
          >
            <Button startIcon={<AddIcon />} onClick={() => setAddColumnOpen(true)}>
              Nouvelle colonne
            </Button>
          </Paper>
        </Box>
        </DndContext>
      ) : (
        <Roadmap detail={detail} onOpenTask={setOpenTaskId} />
      )}

      {/* Nouvelle tâche */}
      <Dialog open={!!addTaskColumn} onClose={() => setAddTaskColumn(null)} fullWidth maxWidth="sm">
        <DialogTitle>Nouvelle tâche</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Titre"
            value={newTaskTitle}
            onChange={(e) => setNewTaskTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void addTask();
            }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddTaskColumn(null)}>Annuler</Button>
          <Button variant="contained" disabled={!newTaskTitle.trim()} onClick={() => void addTask()}>
            Créer
          </Button>
        </DialogActions>
      </Dialog>

      {/* Nouvelle colonne */}
      <Dialog open={addColumnOpen} onClose={() => setAddColumnOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Nouvelle colonne</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Nom"
            value={newColumnName}
            onChange={(e) => setNewColumnName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void addColumn();
            }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddColumnOpen(false)}>Annuler</Button>
          <Button variant="contained" disabled={!newColumnName.trim()} onClick={() => void addColumn()}>
            Créer
          </Button>
        </DialogActions>
      </Dialog>

      {/* Renommer une colonne */}
      <Dialog open={!!renameColumn} onClose={() => setRenameColumn(null)} fullWidth maxWidth="xs">
        <DialogTitle>Renommer la colonne</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Nom"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void renameCol();
            }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameColumn(null)}>Annuler</Button>
          <Button variant="contained" disabled={!renameValue.trim()} onClick={() => void renameCol()}>
            Renommer
          </Button>
        </DialogActions>
      </Dialog>

      {openTaskId && (
        <TaskDialog
          taskId={openTaskId}
          detail={detail}
          onClose={() => setOpenTaskId(null)}
          onChanged={() => void loadRef.current()}
          onOpenTask={setOpenTaskId}
        />
      )}
      <AiDialog
        projectId={projectId}
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        onGenerated={() => void loadRef.current()}
      />
      <MembersDialog
        open={membersOpen}
        detail={detail}
        onClose={() => setMembersOpen(false)}
        onChanged={() => void loadRef.current()}
      />
    </Box>
  );
}

interface ColumnViewProps {
  column: Column;
  tasks: Task[];
  childCounts: Map<string, number>;
  members: UserLite[];
  onOpenTask: (id: string) => void;
  onAddTask: (column: Column) => void;
  onRename: (column: Column) => void;
  onDelete: (column: Column) => void;
}

function ColumnView({ column, tasks, childCounts, members, onOpenTask, onAddTask, onRename, onDelete }: ColumnViewProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  return (
    <Paper
      ref={setNodeRef}
      sx={{
        width: 300,
        flexShrink: 0,
        p: 1,
        bgcolor: isOver ? 'action.selected' : 'grey.100',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', px: 1, py: 0.5 }}>
        <Typography variant="subtitle1" sx={{ flexGrow: 1 }}>
          {column.name} ({tasks.length})
        </Typography>
        <IconButton size="small" onClick={(e) => setMenuAnchor(e.currentTarget)} aria-label="Options colonne">
          <MoreVertIcon fontSize="small" />
        </IconButton>
        <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={() => setMenuAnchor(null)}>
          <MenuItem
            onClick={() => {
              setMenuAnchor(null);
              onRename(column);
            }}
          >
            Renommer
          </MenuItem>
          <MenuItem
            onClick={() => {
              setMenuAnchor(null);
              void onDelete(column);
            }}
          >
            Supprimer
          </MenuItem>
        </Menu>
      </Box>
      {tasks.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          childCount={childCounts.get(task.id) ?? 0}
          members={members}
          onOpen={() => onOpenTask(task.id)}
        />
      ))}
      <Button
        fullWidth
        startIcon={<AddIcon />}
        onClick={() => onAddTask(column)}
        sx={{ justifyContent: 'flex-start' }}
      >
        Ajouter une tâche
      </Button>
    </Paper>
  );
}

interface TaskCardProps {
  task: Task;
  childCount: number;
  members: UserLite[];
  onOpen: () => void;
}

function TaskCard({ task, childCount, members, onOpen }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: task.id });
  const assignee = members.find((m) => m.id === task.assignee_id);
  const style: CSSProperties | undefined = transform
    ? {
        transform: `translate(${transform.x}px, ${transform.y}px)`,
        position: 'relative',
        zIndex: 5,
      }
    : undefined;

  return (
    <Card ref={setNodeRef} style={style} sx={{ mb: 1, cursor: 'pointer' }} onClick={onOpen}>
      <CardContent
        sx={{
          py: 1.5,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 0.5,
          '&:last-child': { pb: 1.5 },
        }}
      >
        <IconButton
          size="small"
          {...attributes}
          {...listeners}
          sx={{ cursor: 'grab' }}
          onClick={(e) => e.stopPropagation()}
          aria-label="Déplacer"
        >
          <DragIndicatorIcon fontSize="small" />
        </IconButton>
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="body2">{task.title}</Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
            <Chip size="small" label={TYPE_LABELS[task.task_type]} color={TYPE_COLORS[task.task_type]} variant="outlined" />
            {task.story_points != null && (
              <Chip size="small" label={`${task.story_points} pts`} variant="outlined" />
            )}
            <PriorityChip priority={task.priority} />
            {childCount > 0 && (
              <Chip size="small" label={`${childCount} ${childCount > 1 ? 'sous-tickets' : 'sous-ticket'}`} />
            )}
            {assignee && (
              <Chip
                size="small"
                avatar={
                  <Avatar src={assignee.avatar_url ?? undefined}>
                    {assignee.login.charAt(0).toUpperCase()}
                  </Avatar>
                }
                label={assignee.login}
              />
            )}
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}
