import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const supabase = url && anonKey && !url.includes('YOUR_PROJECT') && !anonKey.includes('YOUR_SUPABASE')
  ? createClient(url, anonKey)
  : null;

export type Activity = {
  id: string;
  name: string;
  description: string;
  points: number;
  password?: string;
  is_active: boolean;
  image_data?: string | null;
  created_at?: string;
};
export type UserProfile = {
  id: string;
  username: string;
  multiplier: number;
  created_at?: string;
};
export type Completion = { activity_id: string; points_awarded: number; completed_at?: string };

export const makePassword = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
};
export const cleanUsername = (value: string) => value.trim().normalize('NFKC').toLowerCase();
