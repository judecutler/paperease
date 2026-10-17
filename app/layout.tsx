import type { Metadata } from 'next';
import './tokens.css';
import './components.css';
import './app.css';

export const metadata: Metadata = {
  title: 'CareLoop AI',
  description: 'Less chasing. More caring. Compliance documentation agent for home care agencies.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible+Next:wght@400;700&family=IBM+Plex+Mono:wght@400;500&family=Schibsted+Grotesk:wght@500;700&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
