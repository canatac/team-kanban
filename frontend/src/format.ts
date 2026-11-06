import type { TaskType } from './types';

/** Libellés et couleurs des types de tickets Scrum. */
export const TYPE_LABELS: Record<TaskType, string> = {
  epic: 'Epic',
  story: 'User story',
  task: 'Tâche',
  bug: 'Bug',
};

export const TYPE_COLORS: Record<TaskType, 'primary' | 'secondary' | 'default' | 'error'> = {
  epic: 'secondary',
  story: 'primary',
  task: 'default',
  bug: 'error',
};

/** Formatage partagé des compteurs de tokens et des coûts IA. */

export const fmtTokens = (n: number) =>
  new Intl.NumberFormat('fr-FR', {
    notation: n >= 10000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(n);

export const fmtCost = (euros: number) => {
  const small = euros > 0 && euros < 0.01;
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: small ? 4 : 2,
    minimumFractionDigits: small ? 4 : 2,
  }).format(euros);
};
