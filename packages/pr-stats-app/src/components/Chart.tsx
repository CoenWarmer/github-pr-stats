'use client';

import { EuiLoadingSpinner } from '@elastic/eui';
import dynamic from 'next/dynamic';

export const Chart = dynamic(() => import('./ChartImpl'), {
  ssr: false,
  loading: () => (
    <div>
      <div>
        <EuiLoadingSpinner />
        <p>Loading timeline...</p>
      </div>
    </div>
  ),
});
