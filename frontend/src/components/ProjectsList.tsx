import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import LayersIcon from '@mui/icons-material/Layers';
import { api } from '../api';
import type { Project } from '../types';
import FoundationDialog from './FoundationDialog';

export default function ProjectsList({ onSelect }: { onSelect: (id: string) => void }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [foundationOpen, setFoundationOpen] = useState(false);

  useEffect(() => {
    api
      .listProjects()
      .then(setProjects)
      .catch((e) => setError((e as Error).message));
  }, []);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const project = await api.createProject(name.trim());
      setProjects((prev) => (prev ? [project, ...prev] : [project]));
      setName('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const standardCount =
    projects?.filter((p) => p.kind !== 'foundation').length ?? 0;

  return (
    <Container maxWidth="md" sx={{ mt: 4 }}>
      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      <Stack direction="row" spacing={1} sx={{ mb: 3 }}>
        <TextField
          fullWidth
          label="Nouveau projet"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void create();
          }}
        />
        <Button variant="contained" onClick={() => void create()} disabled={busy || !name.trim()}>
          Créer
        </Button>
      </Stack>
      <Box sx={{ mb: 3 }}>
        <Button
          variant="outlined"
          startIcon={<LayersIcon />}
          onClick={() => setFoundationOpen(true)}
          disabled={standardCount < 2}
        >
          Créer un socle (IA)
        </Button>
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
        {(projects ?? []).map((p) => (
          <Card
            key={p.id}
            onClick={() => onSelect(p.id)}
            sx={{ width: 260, cursor: 'pointer', '&:hover': { boxShadow: 6 } }}
          >
            <CardContent>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="h6" sx={{ flexGrow: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {p.name}
                </Typography>
                {p.kind === 'foundation' && (
                  <Chip size="small" color="secondary" label="Socle" />
                )}
              </Stack>
              <Typography variant="caption" color="text.secondary">
                créé le {new Date(p.created_at).toLocaleDateString('fr-FR')}
              </Typography>
            </CardContent>
          </Card>
        ))}
        {projects !== null && projects.length === 0 && (
          <Typography color="text.secondary">
            Aucun projet pour l'instant. Créez-en un ci-dessus.
          </Typography>
        )}
      </Box>
      <FoundationDialog
        open={foundationOpen}
        projects={projects ?? []}
        onClose={() => setFoundationOpen(false)}
        onCreated={onSelect}
      />
    </Container>
  );
}
