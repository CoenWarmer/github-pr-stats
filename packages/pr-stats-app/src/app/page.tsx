'use client';

import dynamic from 'next/dynamic';
import { EuiLoadingSpinner } from '@elastic/eui';

const ClientOnlyPage = dynamic(() => import('@/components/ClientOnlyPage'), {
  ssr: false,
  loading: () => (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        flexDirection: 'column',
        gap: '16px',
      }}
    >
      <EuiLoadingSpinner size="xl" />
      <p>Loading PR Stats...</p>
    </div>
  ),
});

export default function Home() {
  return <ClientOnlyPage />;
}
