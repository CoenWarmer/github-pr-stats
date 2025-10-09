import { EuiBadge, EuiHeader, EuiIcon } from '@elastic/eui';

export function NavBar() {
  return (
    <EuiHeader style={{ padding: 10 }}>
      <EuiBadge
        color="hollow"
        style={{ display: 'flex', verticalAlign: 'middle', borderRadius: 4 }}
      >
        <EuiIcon size="m" type="searchProfilerApp" />
        PR X-Ray
      </EuiBadge>
    </EuiHeader>
  );
}
