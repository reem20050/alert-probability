import type { Region } from '@/types';

export const REGIONS: Region[] = [
  { id: 1, slug: 'gush-dan', name_he: 'גוש דן', name_en: 'Gush Dan', display_order: 1, lat: 32.08, lng: 34.78 },
  { id: 2, slug: 'sharon', name_he: 'השרון', name_en: 'HaSharon', display_order: 2, lat: 32.33, lng: 34.86 },
  { id: 3, slug: 'shfela', name_he: 'השפלה', name_en: 'HaShfela', display_order: 3, lat: 31.85, lng: 34.87 },
  { id: 4, slug: 'negev', name_he: 'הנגב', name_en: 'HaNegev', display_order: 4, lat: 31.25, lng: 34.79 },
  { id: 5, slug: 'haifa', name_he: 'חיפה והקריות', name_en: 'Haifa', display_order: 5, lat: 32.79, lng: 34.99 },
  { id: 6, slug: 'galilee', name_he: 'הגליל', name_en: 'Galilee', display_order: 6, lat: 32.96, lng: 35.50 },
  { id: 7, slug: 'jerusalem', name_he: 'ירושלים והסביבה', name_en: 'Jerusalem', display_order: 7, lat: 31.77, lng: 35.23 },
  { id: 8, slug: 'gaza-envelope', name_he: 'עוטף עזה', name_en: 'Gaza Envelope', display_order: 8, lat: 31.35, lng: 34.38 },
  { id: 9, slug: 'judea-samaria', name_he: 'יהודה ושומרון', name_en: 'Judea & Samaria', display_order: 9, lat: 32.00, lng: 35.20 },
  { id: 10, slug: 'eilat-arava', name_he: 'אילת והערבה', name_en: 'Eilat & Arava', display_order: 10, lat: 29.56, lng: 34.95 },
];

export function getRegionBySlug(slug: string): Region | undefined {
  return REGIONS.find(r => r.slug === slug);
}

export function getAllRegionSlugs(): string[] {
  return REGIONS.map(r => r.slug);
}
