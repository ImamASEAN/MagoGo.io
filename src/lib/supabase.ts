import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined) ||
  "https://gothabjdasaphwzrjnto.supabase.co";
const supabaseAnonKey =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ||
  "sb_publishable_Dx3vXSh8qdQhM1Zi_V1MTQ_ifqdbX1o";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
