import { EuiFlexGroup, EuiFlexItem, EuiText } from '@elastic/eui';

export default function ToolHelp() {
  return (
    <EuiFlexGroup
      gutterSize="m"
      responsive={false}
      direction="row"
      alignItems="center"
    >
      <EuiFlexItem grow={false}>
        <EuiFlexGroup gutterSize="xs" responsive={false} direction="column">
          <EuiFlexItem grow={false}>
            <EuiText size="xs">Option + scroll to zoom</EuiText>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                border: '1px solid rgb(72, 89, 117)',
                borderRadius: '4px',
                padding: '8px',
                height: '24px',
                width: 'fit-content',
              }}
            >
              <div
                style={{
                  width: '18px',
                  height: '18px',
                }}
              >
                <svg
                  fill="#fff"
                  version="1.1"
                  id="icon"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 32 32"
                >
                  <rect x="18" y="5" width="10" height="2" />
                  <polygon points="10.6,5 4,5 4,7 9.4,7 18.4,27 28,27 28,25 19.6,25 " />
                </svg>
              </div>
              +
              <div
                style={{
                  width: '16px',
                  height: '16px',
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  version="1.1"
                  x="0px"
                  y="0px"
                  viewBox="0 0 256 256"
                >
                  <g>
                    <g>
                      <path
                        fill="#fff"
                        d="M152.3,52.1c2.9,2.9,7.6,2.9,10.4,0c2.9-2.9,2.9-7.6,0-10.4l-29.5-29.5c-0.7-0.7-1.5-1.2-2.4-1.6c-1.8-0.7-3.8-0.7-5.6,0c-0.9,0.4-1.7,0.9-2.3,1.5c0,0,0,0,0,0L93.3,41.6c-2.9,2.9-2.9,7.6,0,10.4c2.9,2.9,7.6,2.9,10.4,0l16.9-16.9v185.7l-16.9-16.9c-2.9-2.9-7.6-2.9-10.4,0c-2.9,2.9-2.9,7.6,0,10.4l29.5,29.5c0,0,0,0,0,0c0.7,0.7,1.5,1.2,2.3,1.5c1.8,0.7,3.8,0.7,5.6,0c0.9-0.4,1.7-0.9,2.4-1.6l29.5-29.5c2.9-2.9,2.9-7.6,0-10.4c-2.9-2.9-7.6-2.9-10.4,0l-16.9,16.9V35.2L152.3,52.1z"
                      />
                    </g>
                  </g>
                </svg>
              </div>
            </div>
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiFlexItem>
      <EuiFlexItem grow={false}>
        <EuiFlexGroup gutterSize="xs" responsive={false} direction="column">
          <EuiFlexItem grow={false}>
            <EuiText size="xs">Command (⌘) + drag to select area</EuiText>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                border: '1px solid rgb(72, 89, 117)',
                borderRadius: '4px',
                padding: '8px',
                height: '24px',
                width: 'fit-content',
              }}
            >
              ⌘ +
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  border: '1px dashed #fff',
                  borderRadius: '0px',
                  height: '14px',
                  width: '14px',
                  marginLeft: '4px',
                }}
              ></div>
            </div>
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiFlexItem>
    </EuiFlexGroup>
  );
}
