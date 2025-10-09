import { EuiBadge, EuiHeader, EuiIcon } from '@elastic/eui';
import Link from 'next/link';

export function NavBar() {
  return (
    <EuiHeader style={{ padding: 10 }}>
      <EuiBadge
        style={{ display: 'flex', verticalAlign: 'middle', borderRadius: 4 }}
      >
        <Link style={{ color: 'white' }} href="/">
          <EuiIcon size="m" type="searchProfilerApp" />
          PR X-Ray
        </Link>
      </EuiBadge>
    </EuiHeader>
  );
}
