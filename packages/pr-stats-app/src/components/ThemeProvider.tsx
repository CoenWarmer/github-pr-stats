'use client';

import { EuiProvider } from '@elastic/eui';
import { ReactNode } from 'react';

interface ThemeProviderProps {
  children: ReactNode;
}

export default function ThemeProvider({ children }: ThemeProviderProps) {
  return <EuiProvider>{children}</EuiProvider>;
}
