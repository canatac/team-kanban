import {
  Box,
  Card,
  CardContent,
  Chip,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Tooltip,
  Typography,
} from '@mui/material';
import { TYPE_COLORS, TYPE_LABELS } from '../format';
import type { ProjectDetail, Task } from '../types';

interface RoadmapProps {
  detail: ProjectDetail;
  onOpenTask: (id: string) => void;
}

/** Badge de priorité métier (1 = le plus prioritaire), fixée par l'IA
 * selon le besoin métier défini au départ. */
export function PriorityChip({ priority }: { priority: number | null }) {
  if (priority == null) return null;
  const color =
    priority <= 2 ? 'error' : priority <= 4 ? 'warning' : ('default' as const);
  return (
    <Tooltip title={`Priorité métier P${priority} (1 = le plus prioritaire), fixée par l'IA selon le besoin initial.`}>
      <Chip size="small" label={`P${priority}`} color={color} variant="outlined" />
    </Tooltip>
  );
}

const byPriority = (a: Task, b: Task) =>
  (a.priority ?? 999) - (b.priority ?? 999) || a.created_at.localeCompare(b.created_at);

function TypeChip({ task }: { task: Task }) {
  return (
    <Chip
      size="small"
      label={TYPE_LABELS[task.task_type]}
      color={TYPE_COLORS[task.task_type]}
      variant="outlined"
    />
  );
}

/** Liste imbriquée des descendants d'un ticket, triée par priorité. */
function SubTree({
  task,
  childrenOf,
  onOpenTask,
  depth = 0,
}: {
  task: Task;
  childrenOf: Map<string, Task[]>;
  onOpenTask: (id: string) => void;
  depth?: number;
}) {
  const kids = [...(childrenOf.get(task.id) ?? [])].sort(byPriority);
  return (
    <>
      <ListItemButton
        dense
        sx={{ pl: 1 + depth * 2, borderRadius: 1 }}
        onClick={() => onOpenTask(task.id)}
        secondaryAction={<PriorityChip priority={task.priority} />}
      >
        <ListItemText
          primary={task.title}
          secondary={`${TYPE_LABELS[task.task_type]}${
            task.story_points != null ? ` · ${task.story_points} pts` : ''
          }`}
          primaryTypographyProps={{ variant: 'body2' }}
          secondaryTypographyProps={{ variant: 'caption', color: 'text.secondary' }}
        />
      </ListItemButton>
      {kids.map((kid) => (
        <SubTree
          key={kid.id}
          task={kid}
          childrenOf={childrenOf}
          onOpenTask={onOpenTask}
          depth={depth + 1}
        />
      ))}
    </>
  );
}

/** Carte d'un ticket dans une swimlane : titre cliquable, chips, sous-tickets. */
function NodeCard({
  task,
  childrenOf,
  onOpenTask,
}: {
  task: Task;
  childrenOf: Map<string, Task[]>;
  onOpenTask: (id: string) => void;
}) {
  const kids = [...(childrenOf.get(task.id) ?? [])].sort(byPriority);
  return (
    <Card
      sx={{ width: 300, flexShrink: 0, alignSelf: 'flex-start', cursor: 'pointer' }}
      onClick={() => onOpenTask(task.id)}
    >
      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 0.5 }}>
          <TypeChip task={task} />
          {task.story_points != null && (
            <Chip size="small" label={`${task.story_points} pts`} variant="outlined" />
          )}
          <PriorityChip priority={task.priority} />
        </Box>
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {task.title}
        </Typography>
        {task.user_story && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mt: 0.5, fontStyle: 'italic' }}
          >
            {task.user_story}
          </Typography>
        )}
        {kids.length > 0 && (
          <List dense disablePadding onClick={(e) => e.stopPropagation()}>
            {kids.map((kid) => (
              <SubTree
                key={kid.id}
                task={kid}
                childrenOf={childrenOf}
                onOpenTask={onOpenTask}
              />
            ))}
          </List>
        )}
      </CardContent>
    </Card>
  );
}

/** Swimlane : un epic (ou un groupe « hors epic ») et ses enfants. */
function EpicLane({
  lane,
  childrenOf,
  onOpenTask,
}: {
  lane: {
    id: string | null;
    title: string;
    userStory: string | null;
    priority: number | null;
    kind: 'epic' | 'group';
  };
  childrenOf: Map<string, Task[]>;
  onOpenTask: (id: string) => void;
}) {
  const kids = [...(childrenOf.get(lane.id ?? '') ?? [])].sort(byPriority);
  const points = kids.reduce((sum, t) => sum + (t.story_points ?? 0), 0);
  return (
    <Paper sx={{ p: 1.5, mb: 2, bgcolor: 'grey.100' }}>
      <Box
        sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1, cursor: lane.id ? 'pointer' : 'default' }}
        onClick={() => lane.id && onOpenTask(lane.id)}
      >
        {lane.kind === 'epic' ? (
          <Chip size="small" label="Epic" color="secondary" variant="outlined" />
        ) : (
          <Chip size="small" label="Hors epic" variant="outlined" />
        )}
        {lane.kind === 'epic' && <PriorityChip priority={lane.priority} />}
        <Typography variant="subtitle1" sx={{ fontWeight: 600, flexGrow: 1, minWidth: 0 }} noWrap>
          {lane.title}
        </Typography>
        <Chip size="small" label={`${kids.length} ticket${kids.length > 1 ? 's' : ''} · ${points} pts`} />
      </Box>
      {lane.userStory && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1, fontStyle: 'italic' }}>
          {lane.userStory}
        </Typography>
      )}
      {kids.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Aucun sous-ticket — ouvrez ce ticket et utilisez « Découper (IA) ».
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', gap: 1, overflowX: 'auto', pt: 0.5 }}>
          {kids.map((kid) => (
            <NodeCard key={kid.id} task={kid} childrenOf={childrenOf} onOpenTask={onOpenTask} />
          ))}
        </Box>
      )}
    </Paper>
  );
}

/**
 * Vue Roadmap : swimlanes par epic (triées par priorité métier), user stories
 * et tâches imbriquées. La priorisation vient du besoin métier défini au
 * départ (champ `priority` fixé par l'IA).
 */
export default function Roadmap({ detail, onOpenTask }: RoadmapProps) {
  const childrenOf = new Map<string, Task[]>();
  for (const t of detail.tasks) {
    const key = t.parent_task_id ?? '';
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key)!.push(t);
  }

  const epics = detail.tasks.filter((t) => t.task_type === 'epic').sort(byPriority);
  const orphans = [...(childrenOf.get('') ?? [])]
    .filter((t) => t.task_type !== 'epic')
    .sort(byPriority);

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
        Epics triés par priorité métier (P1 = le plus prioritaire), fixée par l'IA selon le
        besoin défini au départ. Cliquez un ticket pour l'ouvrir.
      </Typography>
      {epics.map((epic) => (
        <EpicLane
          key={epic.id}
          lane={{
            id: epic.id,
            title: epic.title,
            userStory: epic.user_story,
            priority: epic.priority,
            kind: 'epic',
          }}
          childrenOf={childrenOf}
          onOpenTask={onOpenTask}
        />
      ))}
      {orphans.length > 0 && (
        <EpicLane
          lane={{
            id: null,
            title: 'Tickets hors epic',
            userStory: null,
            priority: null,
            kind: 'group',
          }}
          childrenOf={new Map<string, Task[]>([['', orphans]])}
          onOpenTask={onOpenTask}
        />
      )}
    </Box>
  );
}
