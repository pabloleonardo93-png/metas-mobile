interface BrandLogoProps {
  className?: string;
  decorative?: boolean;
}

export const BrandLogo = ({
  className = '',
  decorative = false,
}: BrandLogoProps): React.JSX.Element => (
  <svg
    aria-hidden={decorative || undefined}
    aria-label={decorative ? undefined : 'Logo Metas'}
    className={className}
    role={decorative ? undefined : 'img'}
    viewBox="0 0 160 128"
  >
    <path
      d="M29 105V35L78 78L130 30V105"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="22"
    />
    <path
      className="brand-logo__cutout"
      d="M10 108C48 101 88 84 117 61C130 51 139 38 145 23"
      fill="none"
      strokeLinecap="round"
      strokeWidth="20"
    />
    <path
      d="M7 103C49 97 87 81 117 58C130 48 139 35 145 22C141 39 132 53 119 66C90 94 50 112 20 120Z"
      fill="currentColor"
    />
    <circle cx="147" cy="15" fill="currentColor" r="8" />
  </svg>
);
