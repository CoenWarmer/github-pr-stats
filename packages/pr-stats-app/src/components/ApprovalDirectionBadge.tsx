import { EuiBadge } from '@elastic/eui';

export const approvalDirectionLabelMap = {
  same_team: 'Within Team',
  cross_team: 'Cross Team',
  cross_department: 'Cross Department',
  intra_team: 'Intra Team',
  intra_department: 'Intra Department',
  additional_reviewer: 'Additional Reviewer',
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
