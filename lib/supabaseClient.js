// lib/supabaseClient.js
// Client Supabase pentru BROWSER — folosește doar cheia publică (anon key),
// niciodată service_role aici.
//
// Se încarcă în paginile HTML astfel:
//   <script type="module" src="/lib/supabaseClient.js"></script>
//
// Variabilele SUPABASE_URL / SUPABASE_ANON_KEY sunt injectate la build/deploy
// (Vercel Environment Variables), NU sunt secrete — anon key e public prin design,
// securitatea reală vine din RLS (Row Level Security) din schema.sql.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = window.__ENV__?.SUPABASE_URL || 'https://YOUR-PROJECT.supabase.co';
const SUPABASE_ANON_KEY = window.__ENV__?.SUPABASE_ANON_KEY || 'YOUR-ANON-KEY';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

window.supabaseClient = supabase; // acces global pentru account-system.js
