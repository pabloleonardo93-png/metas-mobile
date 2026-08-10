import type { Campaign } from '@/features/campaigns/types/campaign.types';

export const campaignsMock = [
  {
    id: 'protetor-solar-la-roche',
    name: 'Protetor Solar La Roche',
    targetQuantity: 50,
    soldQuantity: 32,
    startDate: '2026-08-10',
    endDate: '2026-08-31',
    status: 'ATIVA',
  },
  {
    id: 'vitamina-c-equaliv',
    name: 'Vitamina C Equaliv',
    targetQuantity: 30,
    soldQuantity: 24,
    startDate: '2026-08-01',
    endDate: '2026-08-31',
    status: 'ATIVA',
  },
  {
    id: 'omega-3-equaliv',
    name: 'Ômega 3 Equaliv',
    targetQuantity: 25,
    soldQuantity: 15,
    startDate: '2026-08-05',
    endDate: '2026-08-29',
    status: 'ATIVA',
  },
  {
    id: 'hidratacao-neutrogena',
    name: 'Hidratação Neutrogena',
    targetQuantity: 40,
    soldQuantity: 0,
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    status: 'AGENDADA',
  },
  {
    id: 'repelente-exposis',
    name: 'Repelente Exposis',
    targetQuantity: 20,
    soldQuantity: 20,
    startDate: '2026-07-01',
    endDate: '2026-07-31',
    status: 'ENCERRADA',
  },
] satisfies Campaign[];
