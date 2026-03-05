import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'סיכוי אזעקה - מפת הסתברות התרעות',
  description: 'לוח מחוונים המציג את הסתברות האזעקות לפי אזורים בישראל, מתעדכן כל 5 דקות',
  icons: { icon: '/favicon.ico' },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="he" dir="rtl">
      <body className="min-h-screen bg-[#0a0a0a] text-white antialiased">
        <header className="border-b border-gray-800 bg-[#0a0a0a]/80 backdrop-blur-sm sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">סיכוי אזעקה</h1>
              <p className="text-sm text-gray-400">מפת הסתברות התרעות בישראל</p>
            </div>
            <div className="text-xs text-gray-500">
              מבוסס על נתוני פיקוד העורף
            </div>
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-4 py-6">
          {children}
        </main>
        <footer className="border-t border-gray-800 mt-12">
          <div className="max-w-7xl mx-auto px-4 py-6 text-center text-xs text-gray-600">
            <p>האתר מציג הערכת סיכוי בלבד ואינו מהווה מקור רשמי להתרעות.</p>
            <p className="mt-1">הנתונים מבוססים על ניתוח סטטיסטי של התרעות פיקוד העורף.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
