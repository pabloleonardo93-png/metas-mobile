import type { Pharmacy } from '../api/management.contracts';
import { RowActionsMenu } from './RowActionsMenu';

interface PharmacyActionsMenuProps {
  addManager: (pharmacy: Pick<Pharmacy, 'id' | 'name'>) => void;
  pharmacy: Pharmacy;
}

export const PharmacyActionsMenu = ({
  addManager,
  pharmacy,
}: PharmacyActionsMenuProps): React.JSX.Element | null => {
  if (!pharmacy.isActive) return null;

  return (
    <RowActionsMenu
      ariaLabel={`Mais ações para ${pharmacy.name}`}
      items={[{ label: 'Adicionar gestor', onSelect: () => addManager(pharmacy) }]}
    />
  );
};
