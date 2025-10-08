import {
  EuiFlexGroup,
  EuiFlexItem,
  EuiSpacer,
  EuiStat,
  EuiText,
  EuiToolTip,
} from '@elastic/eui';
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
  // Count occurrences of each relationship type
  const relationshipCounts = authorCodeownerRelationships.reduce(
    (acc, relationship) => {
      acc[relationship] = (acc[relationship] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  // Get unique relationships to display
  const uniqueRelationships = Array.from(new Set(authorCodeownerRelationships));

  return (
    <EuiToolTip
      display="block"
      content={
        <EuiFlexGroup direction="column">
          {Object.entries(relationshipCounts).map(([relationship, count]) => (
            <EuiFlexItem key={relationship}>
              <EuiStat
                title={count.toString()}
                description={
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <span>files</span>
                    <ApprovalDirectionBadge
                      authorCodeownerRelationship={relationship}
                    />
                  </div>
                }
                titleSize="s"
                reverse
              />
            </EuiFlexItem>
          ))}
        </EuiFlexGroup>
      }
    >
      <>
        {uniqueRelationships.map((relationship, index) => (
          <ApprovalDirectionBadge
            key={index}
            authorCodeownerRelationship={relationship}
          />
        ))}

        <EuiSpacer size="s" />
        <EuiText size="s">Author Codeowner Relationship</EuiText>
      </>
    </EuiToolTip>
  );
}
