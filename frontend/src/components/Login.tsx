import { Button, Card, Container, Typography } from '@mui/material';
import GitHubIcon from '@mui/icons-material/GitHub';

export default function Login() {
  return (
    <Container maxWidth="sm" sx={{ display: 'flex', alignItems: 'center', minHeight: '100vh' }}>
      <Card sx={{ width: '100%', textAlign: 'center', p: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Team Kanban
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 4 }}>
          Gestion de projets collaborative, simple et en temps réel.
        </Typography>
        <Button
          variant="contained"
          size="large"
          startIcon={<GitHubIcon />}
          href="/api/auth/github"
        >
          Se connecter avec GitHub
        </Button>
      </Card>
    </Container>
  );
}
