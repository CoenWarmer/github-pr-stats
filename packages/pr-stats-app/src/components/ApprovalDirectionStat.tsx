import {
  EuiBadge,
  EuiFlexGroup,
  EuiFlexItem,
  euiPaletteColorBlindBehindText,
  EuiSpacer,
  EuiStat,
  EuiText,
  EuiToolTip,
} from '@elastic/eui';
import {
  ApprovalDirectionBadge,
  approvalDirectionLabelMap,
} from './ApprovalDirectionBadge';

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

  const palette = euiPaletteColorBlindBehindText({ sortBy: 'natural' });

  const totalCount = Object.values(relationshipCounts).reduce(
    (acc, count) => acc + count,
    0
  );

  return (
    <>
      <div
        style={{
          display: 'flex',
          height: '18px',
          borderRadius: '2px',
          overflow: 'hidden',
        }}
      >
        {Object.entries(relationshipCounts).map(
          ([relationship, count], index) => {
            const percentage = ((count / totalCount) * 100).toFixed(0);
            const color = palette[index + 1];
            return (
              <div
                key={relationship}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  background: color,
                  width: percentage + '%',
                  overflow: 'hidden',
                }}
              >
                <EuiToolTip
                  display="block"
                  position="bottom"
                  content={
                    <div>
                      {count} files -{' '}
                      {
                        approvalDirectionLabelMap[
                          relationship as keyof typeof approvalDirectionLabelMap
                        ]
                      }{' '}
                      ({percentage}%)
                    </div>
                  }
                >
                  <EuiBadge color={color}>{percentage + '%'}</EuiBadge>
                </EuiToolTip>
              </div>
            );
          }
        )}
      </div>
      <EuiToolTip
        display="block"
        position="bottom"
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
        <div>
          <EuiSpacer size="s" />
          <EuiText size="s">Author Codeowner Relationship</EuiText>
        </div>
      </EuiToolTip>
    </>
  );
}
