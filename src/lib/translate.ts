import { supabase } from './supabase';

export interface TranslateResult {
  targetLang: 'en' | 'ar';
  title: string;
  description: string;
}

export interface TranslateError {
  // True when the edge function is deployed but ANTHROPIC_API_KEY hasn't
  // been configured yet -- lets the UI show a clearer "not set up yet"
  // message instead of a generic failure.
  notConfigured: boolean;
  message: string;
}

// Calls the translate-listing edge function to get the seller's title/
// description suggested in the *other* language. Never throws --
// callers get back either { data } or { error } so a translation hiccup
// never blocks posting the listing.
export async function translateListing(
  title: string,
  description: string,
  sourceLang: 'en' | 'ar'
): Promise<{ data?: TranslateResult; error?: TranslateError }> {
  try {
    const { data, error } = await supabase.functions.invoke('translate-listing', {
      body: { title, description, sourceLang },
    });
    if (error) {
      let message = 'Automatic translation is not available right now.';
      let notConfigured = false;
      const context = (error as any)?.context;
      if (context && typeof context.json === 'function') {
        try {
          const body = await context.json();
          if (body?.error === 'not_configured') notConfigured = true;
          if (body?.message) message = body.message;
        } catch (e) {
          // Response body wasn't JSON -- fall back to the generic message.
        }
      }
      return { error: { notConfigured, message } };
    }
    if (!data || typeof data.title !== 'string') {
      return { error: { notConfigured: false, message: 'Automatic translation is not available right now.' } };
    }
    return { data: data as TranslateResult };
  } catch (e: any) {
    return { error: { notConfigured: false, message: e?.message || 'Automatic translation is not available right now.' } };
  }
}
