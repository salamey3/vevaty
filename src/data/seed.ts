import { Listing } from '../types';

// Intentionally empty — the feed's content comes from Supabase.
//
// This used to hold four sample listings so Home wouldn't look broken on a
// fresh install. That made sense before there was a backend; now it means
// anyone opening the app offline, on a fresh install, or straight after
// signing out sees four fake listings presented exactly like real ones.
// AppStore falls back to this list in all three of those cases, so the only
// way for the feed to be honestly empty is for the fallback to be empty.
export const SEED_LISTINGS: Listing[] = [];
