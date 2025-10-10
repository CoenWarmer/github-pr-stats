import { EuiBadge, EuiHeader, EuiIcon, EuiText } from '@elastic/eui';
import Link from 'next/link';

export function NavBar() {
  return (
    <EuiHeader style={{ padding: 10, display: 'flex', alignItems: 'center' }}>
      <EuiBadge
        style={{ display: 'flex', verticalAlign: 'middle', borderRadius: 4 }}
      >
        <Link style={{ color: 'white' }} href="/">
          <EuiIcon size="m" type="searchProfilerApp" />
          PR X-Ray
        </Link>
      </EuiBadge>

      <EuiText size="xs">
        <Link
          href={process.env.NEXT_PUBLIC_NAV_BAR_LINK || '/'}
          target="_blank"
        >
          <strong>
            {process.env.NEXT_PUBLIC_NAV_BAR_TEXT ||
              'Explore this and more data'}{' '}
            <EuiIcon size="s" type="popout" />
          </strong>
        </Link>
      </EuiText>
    </EuiHeader>
  );
}
