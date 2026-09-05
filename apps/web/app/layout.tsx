import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: 'Tessera',
  description: 'A multiplayer whiteboard with CRDT sync. Hand-written canvas renderer, no canvas library.',
};

const RootLayout = ({ children }: { readonly children: ReactNode }) => (
  <html lang="en" className="h-full">
    <body className="h-full overflow-hidden bg-white text-slate-900 antialiased">{children}</body>
  </html>
);

export default RootLayout;
