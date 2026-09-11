export const managementActionLabels: Record<string, string> = {
  STORE_CREATED: 'Farmácia criada',
  STORE_UPDATED: 'Farmácia editada',
  STORE_ACTIVATED: 'Farmácia ativada',
  STORE_DEACTIVATED: 'Farmácia desativada',
  EMPLOYEE_UPDATED: 'Pessoa editada',
  EMPLOYEE_ROLE_CHANGED: 'Função alterada',
  EMPLOYEE_ACTIVATED: 'Vínculo reativado',
  EMPLOYEE_DEACTIVATED: 'Vínculo desativado',
  EMPLOYEE_CREATED: 'Pessoa adicionada',
  EMPLOYEE_LINKED: 'Vínculo criado',
};

export const formatManagementDate = (value: string): string =>
  new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(value),
  );
