import { EuiSpacer, EuiText } from '@elastic/eui';
import { ApprovalDirectionBadge } from './ApprovalDirectionBadge';

export function ApprovalDirectionStat({
  authorCodeownerRelationships,
}: {
  authorCodeownerRelationships: (
    | 'same-team'
    | 'intra-team'
    | 'intra-department'
    | 'cross-department'
    | 'additional-reviewer'
  )[];
}) {
  return (
    <>
      {authorCodeownerRelationships.map((relationship, index) => (
        <ApprovalDirectionBadge
          key={index}
          authorCodeownerRelationship={relationship}
        />
      ))}

      <EuiSpacer size="s" />
      <EuiText size="s">Author Codeowner Relationship</EuiText>
    </>
  );
}
