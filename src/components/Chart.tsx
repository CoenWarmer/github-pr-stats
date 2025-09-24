'use client';

import dynamic from 'next/dynamic';

export const Chart = dynamic(() => import('./ChartImpl'), {
  ssr: false,
});
