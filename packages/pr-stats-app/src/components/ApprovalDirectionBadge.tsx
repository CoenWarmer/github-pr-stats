import { EuiBadge } from '@elastic/eui';

export function ApprovalDirectionBadge({
  authorCodeownerRelationship,
}: {
  authorCodeownerRelationship: string;
}) {
  const labelMap = {
    'same-team': 'Same Team as Code Owners',
    'cross-team': 'Cross Team',
    'cross-department': 'Cross Department',
    'intra-team': 'Intra Team',
    'intra-department': 'Intra Department',
  };

  return authorCodeownerRelationship ? (
    <EuiBadge color="hollow">
      {labelMap[authorCodeownerRelationship as keyof typeof labelMap]}
    </EuiBadge>
  ) : null;
}
