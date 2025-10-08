'use client';

import dynamic from 'next/dynamic';

// Create a client-only version of the PR page to avoid hydration mismatches
const ClientOnlyPrPage = dynamic(() => import('./ClientOnlyPrPage'), {
  ssr: false,
  loading: () => (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
      }}
    >
      <div>Loading...</div>
    </div>
  ),
});

export default function PrPage() {
  return <ClientOnlyPrPage />;
}
