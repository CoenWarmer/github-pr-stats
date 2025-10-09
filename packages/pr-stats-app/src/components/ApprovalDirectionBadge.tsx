import { EuiBadge } from '@elastic/eui';

export const approvalDirectionLabelMap = {
  'same-team': 'Within Team',
  'cross-team': 'Cross Team',
  'cross-department': 'Cross Department',
  'intra-team': 'Intra Team',
  'intra-department': 'Intra Department',
  'additional-reviewer': 'Additional Reviewer',
};

export function ApprovalDirectionBadge({
  authorCodeownerRelationship,
}: {
  authorCodeownerRelationship: string;
}) {
  return authorCodeownerRelationship ? (
    <EuiBadge color="hollow">
      {
        approvalDirectionLabelMap[
          authorCodeownerRelationship as keyof typeof approvalDirectionLabelMap
        ]
      }
    </EuiBadge>
  ) : null;
}
