import { useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  TextField,
  Typography,
} from '@mui/material';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import DeleteIcon from '@mui/icons-material/Delete';
import { api } from '../api';
import type { GenerationSummary } from '../types';

interface AiDialogProps {
  projectId: string;
  open: boolean;
  onClose: () => void;
  onGenerated: () => void;
}

/**
 * Génération de tickets par IA (Mistral) à partir d'un prompt
 * décrivant le projet, avec fichiers joints optionnels
 * (images, PDF, fichiers texte).
 */
export default function AiDialog({ projectId, open, onClose, onGenerated }: AiDialogProps) {
  const [prompt, setPrompt] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerationSummary | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setPrompt('');
    setFiles([]);
    setError(null);
    setResult(null);
  };

  const handleClose = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      if (next.length >= 5) {
        setError('Maximum 5 fichiers.');
        break;
      }
      if (f.size > 10 * 1024 * 1024) {
        setError(`${f.name} dépasse 10 Mo.`);
        continue;
      }
      next.push(f);
    }
    setFiles(next);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const generate = async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const summary = await api.generateTasks(projectId, prompt.trim(), files);
      setResult(summary);
      onGenerated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <AutoAwesomeIcon color="primary" />
        Générer des tickets avec l'IA
      </DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          multiline
          minRows={5}
          label="Décrivez le projet, l'équipe, les objectifs…"
          placeholder="Ex. : Application mobile de covoiturage pour les employés : covoiturage domicile-travail, flotte de voitures partagées, réservation, badges de fidélité, facturation mensuelle…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={busy}
          sx={{ mt: 1 }}
        />

        <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            accept="image/*,application/pdf,text/*,.md,.json,.csv,.txt,.xml,.yml,.yaml"
            onChange={(e) => addFiles(e.target.files)}
          />
          <Button
            startIcon={<AttachFileIcon />}
            onClick={() => fileInputRef.current?.click()}
            disabled={busy || files.length >= 5}
          >
            Joindre des fichiers ({files.length}/5)
          </Button>
          <Typography variant="caption" color="text.secondary">
            Images, PDF ou fichiers texte (10 Mo max / fichier)
          </Typography>
        </Box>

        {files.length > 0 && (
          <Box sx={{ mt: 1, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {files.map((f, i) => (
              <Chip
                key={`${f.name}-${i}`}
                label={f.name}
                onDelete={() => setFiles(files.filter((_, j) => j !== i))}
                deleteIcon={<DeleteIcon />}
              />
            ))}
          </Box>
        )}

        {busy && (
          <Alert severity="info" icon={<CircularProgress size={20} />} sx={{ mt: 2 }}>
            L'IA analyse votre demande et rédige les tickets… (jusqu'à une minute)
          </Alert>
        )}
        {error && (
          <Alert severity="error" sx={{ mt: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        {result && (
          <Alert severity="success" sx={{ mt: 2 }}>
            {result.tasks_created > 0
              ? `${result.tasks_created} ticket${result.tasks_created > 1 ? 's' : ''} créé${result.tasks_created > 1 ? 's' : ''}${result.columns_created > 0 ? ` (+ ${result.columns_created} nouvelle${result.columns_created > 1 ? 's' : ''} colonne${result.columns_created > 1 ? 's' : ''})` : ''}. Le tableau est à jour.`
              : "L'IA n'a proposé aucun ticket — essayez un brief plus détaillé."}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={busy}>
          {result ? 'Fermer' : 'Annuler'}
        </Button>
        <Button
          variant="contained"
          startIcon={<AutoAwesomeIcon />}
          disabled={!prompt.trim() || busy}
          onClick={() => void generate()}
        >
          {busy ? 'Génération…' : 'Générer les tickets'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
