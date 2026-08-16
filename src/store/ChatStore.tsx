import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { ChatMessage, ChatThread } from '../types';
import { supabase, ensureSession } from '../lib/supabase';

// Phase 4 item 11 -- real in-app chat, built directly on top of the
// `chat_threads`/`chat_messages` tables. Both tables (and their RLS
// policies -- participants can create/read threads, participants can
// send/read messages within a thread they're in) already existed, unused,
// from an earlier session; this store is the first thing to actually read
// or write them. See project memory's "Phase 4" section for the full
// verification trail (RLS confirmed correct 2026-08-14; this session also
// added both tables to the `supabase_realtime` publication, which hadn't
// been done for any table in this project before -- without that, the
// realtime subscriptions below would silently never fire).
//
// Deliberately separate from AppStore/SettingsStore: chat has its own
// realtime lifecycle (subscribe/unsubscribe per open thread) that doesn't
// belong mixed into either of those.

function dbThreadToLocal(row: any): ChatThread {
  return {
    id: row.id,
    listingId: row.listing_id,
    buyerId: row.buyer_id,
    sellerId: row.seller_id,
    createdAt: new Date(row.created_at).getTime(),
  };
}

function dbMessageToLocal(row: any): ChatMessage {
  return {
    id: row.id,
    threadId: row.thread_id,
    senderId: row.sender_id,
    body: row.body,
    createdAt: new Date(row.created_at).getTime(),
    kind: row.kind === 'offer' ? 'offer' : 'text',
    offerAmount: row.offer_amount != null ? Number(row.offer_amount) : null,
    offerStatus: row.offer_status === 'pending' || row.offer_status === 'accepted' || row.offer_status === 'declined' ? row.offer_status : null,
  };
}

interface ChatStoreValue {
  threads: ChatThread[];
  threadsLoading: boolean;
  messagesByThread: Record<string, ChatMessage[]>;
  // Loads (or reloads) every thread the current user is a participant in
  // (as buyer or seller), newest first. Call when the Messages tab mounts.
  loadThreads: () => Promise<void>;
  // Loads a single thread's full message history, oldest first.
  loadMessages: (threadId: string) => Promise<void>;
  // Finds the current user's existing thread for this listing (as buyer),
  // or creates one -- there's at most one buyer<->seller thread per
  // listing, matching how OLX and most classifieds apps group messages.
  // Returns the thread id either way.
  getOrCreateThread: (listingId: string, sellerId: string) => Promise<string>;
  sendMessage: (threadId: string, body: string) => Promise<void>;
  // Phase 4 item 15 -- a structured offer message. `body` is still set to
  // a human-readable fallback so nothing that only ever reads `body`
  // renders blank.
  sendOffer: (threadId: string, amount: number) => Promise<void>;
  // The offer's RECIPIENT accepts/declines it -- ChatThreadScreen is what
  // enforces "only the non-sender sees these buttons", this just does the
  // write once called.
  respondToOffer: (messageId: string, status: 'accepted' | 'declined') => Promise<void>;
  // Subscribes to new messages landing in one thread (Realtime), AND to
  // updates on existing ones (Phase 4 item 15 -- an offer's status
  // changing when the other participant accepts/declines it). Returns an
  // unsubscribe function -- call it on unmount so a closed thread screen
  // doesn't keep a channel open forever.
  subscribeToThread: (threadId: string) => () => void;
  // Resolves auth.uid() for the current session -- exposed so screens can
  // tell "me" apart from "the other participant" without re-implementing
  // ensureSession() everywhere (message bubbles, thread-list "you:" prefix).
  currentUserId: () => Promise<string>;
}

const ChatStoreContext = createContext<ChatStoreValue | null>(null);

export function ChatStoreProvider({ children }: { children: React.ReactNode }) {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [messagesByThread, setMessagesByThread] = useState<Record<string, ChatMessage[]>>({});
  // Tracks channels this provider has open so a second subscribeToThread
  // call for the same thread (e.g. StrictMode double-mount) reuses/replaces
  // rather than leaking a duplicate subscription.
  const channelsRef = useRef<Record<string, ReturnType<typeof supabase.channel>>>({});

  const currentUserId = useCallback(async () => {
    const session = await ensureSession();
    if (!session?.user?.id) throw new Error('Not signed in');
    return session.user.id;
  }, []);

  const loadThreads = useCallback(async () => {
    setThreadsLoading(true);
    try {
      const uid = await currentUserId();
      const { data, error } = await supabase
        .from('chat_threads')
        .select('*')
        .or(`buyer_id.eq.${uid},seller_id.eq.${uid}`)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setThreads((data || []).map(dbThreadToLocal));
    } finally {
      setThreadsLoading(false);
    }
  }, [currentUserId]);

  const loadMessages = useCallback(async (threadId: string) => {
    const { data, error } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    setMessagesByThread((m) => ({ ...m, [threadId]: (data || []).map(dbMessageToLocal) }));
  }, []);

  const getOrCreateThread = useCallback(async (listingId: string, sellerId: string) => {
    const uid = await currentUserId();
    // A seller viewing their own listing should never end up messaging
    // themselves -- ListingDetailScreen already hides the CTA for owners,
    // this is just defense in depth.
    if (uid === sellerId) throw new Error('Cannot message yourself');

    const { data: existing, error: findErr } = await supabase
      .from('chat_threads')
      .select('*')
      .eq('listing_id', listingId)
      .eq('buyer_id', uid)
      .maybeSingle();
    if (findErr) throw findErr;
    if (existing) {
      const thread = dbThreadToLocal(existing);
      setThreads((prev) => (prev.some((t) => t.id === thread.id) ? prev : [thread, ...prev]));
      return thread.id;
    }

    const { data: created, error: insertErr } = await supabase
      .from('chat_threads')
      .insert({ listing_id: listingId, buyer_id: uid, seller_id: sellerId })
      .select()
      .single();
    if (insertErr) throw insertErr;
    const thread = dbThreadToLocal(created);
    setThreads((prev) => [thread, ...prev]);
    return thread.id;
  }, [currentUserId]);

  const sendMessage = useCallback(async (threadId: string, body: string) => {
    const trimmed = body.trim();
    if (!trimmed) return;
    const uid = await currentUserId();
    const { data, error } = await supabase
      .from('chat_messages')
      .insert({ thread_id: threadId, sender_id: uid, body: trimmed })
      .select()
      .single();
    if (error) throw error;
    const message = dbMessageToLocal(data);
    // Optimistic append, deduped by id in case the Realtime subscription
    // below also delivers this same insert back to us.
    setMessagesByThread((m) => {
      const existing = m[threadId] || [];
      if (existing.some((msg) => msg.id === message.id)) return m;
      return { ...m, [threadId]: [...existing, message] };
    });
  }, [currentUserId]);

  const sendOffer = useCallback(async (threadId: string, amount: number) => {
    if (!(amount > 0)) return;
    const uid = await currentUserId();
    const { data, error } = await supabase
      .from('chat_messages')
      .insert({
        thread_id: threadId,
        sender_id: uid,
        body: `Offer: $${amount.toLocaleString()}`,
        kind: 'offer',
        offer_amount: amount,
        offer_status: 'pending',
      })
      .select()
      .single();
    if (error) throw error;
    const message = dbMessageToLocal(data);
    setMessagesByThread((m) => {
      const existing = m[threadId] || [];
      if (existing.some((msg) => msg.id === message.id)) return m;
      return { ...m, [threadId]: [...existing, message] };
    });
  }, [currentUserId]);

  const respondToOffer = useCallback(async (messageId: string, status: 'accepted' | 'declined') => {
    const { data, error } = await supabase
      .from('chat_messages')
      .update({ offer_status: status })
      .eq('id', messageId)
      .select()
      .single();
    if (error) throw error;
    const message = dbMessageToLocal(data);
    setMessagesByThread((m) => {
      const existing = m[message.threadId] || [];
      return { ...m, [message.threadId]: existing.map((msg) => (msg.id === message.id ? message : msg)) };
    });
  }, []);

  const subscribeToThread = useCallback((threadId: string) => {
    // Replace any existing channel for this thread rather than stacking a
    // second one on top of it.
    channelsRef.current[threadId]?.unsubscribe();
    const channel = supabase
      .channel(`chat_messages:${threadId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'myazar', table: 'chat_messages', filter: `thread_id=eq.${threadId}` },
        (payload) => {
          const message = dbMessageToLocal(payload.new);
          setMessagesByThread((m) => {
            const existing = m[threadId] || [];
            if (existing.some((msg) => msg.id === message.id)) return m;
            return { ...m, [threadId]: [...existing, message] };
          });
        }
      )
      .on(
        // Phase 4 item 15 -- the other participant accepting/declining an
        // offer lands here as an UPDATE, not an INSERT.
        'postgres_changes',
        { event: 'UPDATE', schema: 'myazar', table: 'chat_messages', filter: `thread_id=eq.${threadId}` },
        (payload) => {
          const message = dbMessageToLocal(payload.new);
          setMessagesByThread((m) => {
            const existing = m[threadId] || [];
            if (!existing.some((msg) => msg.id === message.id)) return m;
            return { ...m, [threadId]: existing.map((msg) => (msg.id === message.id ? message : msg)) };
          });
        }
      )
      .subscribe((status) => {
        // 'SUBSCRIBED' fires on the initial subscribe AND every time the
        // realtime client auto-reconnects after a dropped connection --
        // e.g. a mobile browser suspending the tab's websocket while
        // backgrounded/locked, or a brief network blip. Reloading history
        // here closes the gap between a drop and the reconnect, instead of
        // silently missing messages sent while disconnected until the user
        // manually leaves and re-enters the thread (reported live
        // 2026-08-14: a reply sent from another device didn't appear on
        // the receiving phone until the thread screen was closed/reopened).
        if (status === 'SUBSCRIBED') {
          loadMessages(threadId).catch(() => {});
        }
      });
    channelsRef.current[threadId] = channel;
    return () => {
      channel.unsubscribe();
      delete channelsRef.current[threadId];
    };
  }, [loadMessages]);

  // Memoized so consumers don't re-render purely because this provider did
  // -- see the matching comment in FavoritesStore. Every function above is
  // already a stable useCallback.
  const value = useMemo<ChatStoreValue>(
    () => ({
      threads,
      threadsLoading,
      messagesByThread,
      loadThreads,
      loadMessages,
      getOrCreateThread,
      sendMessage,
      sendOffer,
      respondToOffer,
      subscribeToThread,
      currentUserId,
    }),
    [
      threads,
      threadsLoading,
      messagesByThread,
      loadThreads,
      loadMessages,
      getOrCreateThread,
      sendMessage,
      sendOffer,
      respondToOffer,
      subscribeToThread,
      currentUserId,
    ],
  );

  return <ChatStoreContext.Provider value={value}>{children}</ChatStoreContext.Provider>;
}

export function useChat() {
  const ctx = useContext(ChatStoreContext);
  if (!ctx) throw new Error('useChat must be used within ChatStoreProvider');
  return ctx;
}
