import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  TextField,
  Typography,
} from '@mui/material';
import { api } from '../api';
import type { Project } from '../types';

interface Props {
  open: boolean;
  projects: Project[];
  onClose: () => void;
  /** Appelé avec l'id du socle créé — navigation directe. */
  onCreated: (projectId: string) => void;
}

export default function FoundationDialog({ open, projects, onClose, onCreated }: Props) {
  const selectable = useMemo(() => projects.filter((p) => p.kind !== 'foundation'), [projects]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const create = async () => {
    if (!name.trim() || selected.size < 2) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.createFoundation(
        name.trim(),
        selectable.filter((p) => selected.has(p.id)).map((p) => p.id),
      );
      setSelected(new Set());
      setName('');
      onCreated(result.project.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (busy) return;
    setSelected(new Set());
    setName('');
    setError(null);
    onClose();
  };

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm">
      <DialogTitle>Créer un socle commun (IA)</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Sélectionnez au moins deux projets. Mistral comparera leurs tickets et créera un
          nouveau projet « socle » contenant les tickets communs, ajustés et priorisés par
          besoin métier. L'appel peut prendre une à deux minutes.
        </Typography>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <TextField
          fullWidth
          label="Nom du projet socle"
          value={name}
          onChange={(e) => setName(e.target.value)}
          sx={{ mb: 2 }}
        />
        <Typography variant="subtitle2">
          Projets sources ({selected.size} sélectionné{selected.size > 1 ? 's' : ''})
        </Typography>
        <List dense sx={{ maxHeight: 300, overflow: 'auto' }}>
          {selectable.map((p) => {
            const labelId = `foundation-checkbox-${p.id}`;
            return (
              <ListItem key={p.id} button onClick={() => toggle(p.id)}>
                <ListItemIcon>
                  <Checkbox
                    edge="start"
                    checked={selected.has(p.id)}
                    tabIndex={-1}
                    inputProps={{ 'aria-labelledby': labelId }}
                  />
                </ListItemIcon>
                <ListItemText id={labelId} primary={p.name} />
              </ListItem>
            );
          })}
          {selectable.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
              Aucun projet standard disponible.
            </Typography>
          )}
        </List>
      </DialogContent>
      <DialogActions>
        {busy ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mr: 'auto', pl: 2 }}>
            <CircularProgress size={20} />
            <Typography variant="body2" color="text.secondary">
              Mistral compare les tickets…
            </Typography>
          </Box>
        ) : (
          <>
            <Button onClick={close}>Annuler</Button>
            <Button
              variant="contained"
              onClick={() => void create()}
              disabled={!name.trim() || selected.size < 2}
            >
              Créer le socle
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
