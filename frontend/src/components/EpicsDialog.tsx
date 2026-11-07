import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';
import { api } from '../api';

interface Props {
  open: boolean;
  projectId: string;
  /** Nombre de tickets de premier niveau organisables. */
  candidates: number;
  /** Nombre d'epics existants (réutilisables par l'IA). */
  epicCount: number;
  onClose: () => void;
  /** Appelé après une organisation réussie. */
  onDone: (result: { created: number; moved: number }) => void;
}

export default function EpicsDialog({
  open,
  projectId,
  candidates,
  epicCount,
  onClose,
  onDone,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.deduceEpics(projectId);
      onDone({ created: result.created, moved: result.moved });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (busy) return;
    setError(null);
    onClose();
  };

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm">
      <DialogTitle>Organiser en epics (IA)</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Mistral va analyser les {candidates} tickets de premier niveau du projet et les
          regrouper en epics cohérents
          {epicCount > 0
            ? ` — les ${epicCount} epic${epicCount > 1 ? 's' : ''} existant${
                epicCount > 1 ? 's' : ''
              } seront réutilisé${epicCount > 1 ? 's' : ''} quand c'est pertinent`
            : ''}
          . Les tickets ne correspondant à aucun epic resteront « hors epic ». L'analyse
          peut prendre une à deux minutes.
        </Typography>
        {error && (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        {busy ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mr: 'auto', pl: 2 }}>
            <CircularProgress size={20} />
            <Typography variant="body2" color="text.secondary">
              Mistral analyse les tickets…
            </Typography>
          </Box>
        ) : (
          <>
            <Button onClick={close}>Annuler</Button>
            <Button variant="contained" onClick={() => void run()}>
              Organiser
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
