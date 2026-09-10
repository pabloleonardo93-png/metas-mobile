export type AdminIconName = 'audit' | 'dashboard' | 'employees' | 'pharmacy' | 'settings';

export const AdminIcon = ({ name }: { name: AdminIconName }): React.JSX.Element => (
  <svg aria-hidden="true" className="admin-icon" viewBox="0 0 24 24">
    {name === 'dashboard' ? (
      <>
        <rect height="7" rx="1" width="7" x="3" y="3" />
        <rect height="7" rx="1" width="7" x="14" y="3" />
        <rect height="7" rx="1" width="7" x="3" y="14" />
        <rect height="7" rx="1" width="7" x="14" y="14" />
      </>
    ) : name === 'pharmacy' ? (
      <>
        <path d="M4 21V8l8-5 8 5v13" />
        <path d="M9 21v-6h6v6M9 10h6M12 7v6M3 21h18" />
      </>
    ) : name === 'employees' ? (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 20v-2.2A4.8 4.8 0 0 1 8.3 13h1.4a4.8 4.8 0 0 1 4.8 4.8V20" />
        <path d="M15.5 5.4a3 3 0 0 1 0 5.2M17 13.3a4.8 4.8 0 0 1 3.5 4.5V20" />
      </>
    ) : name === 'audit' ? (
      <>
        <path d="M6 3h9l3 3v15H6z" />
        <path d="M14 3v4h4M9 11h6M9 15h6M9 19h4" />
      </>
    ) : (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
      </>
    )}
  </svg>
);
