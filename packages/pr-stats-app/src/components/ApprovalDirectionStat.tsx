import { EuiSpacer, EuiText } from '@elastic/eui';
import { ApprovalDirectionBadge } from './ApprovalDirectionBadge';

export function ApprovalDirectionStat({
  authorCodeownerRelationship,
}: {
  authorCodeownerRelationship: string;
}) {
  return (
    <>
      <ApprovalDirectionBadge
        authorCodeownerRelationship={authorCodeownerRelationship ?? ''}
      />
      <EuiSpacer size="s" />
      <EuiText size="s">Author Codeowner Relationship</EuiText>
    </>
  );
}
