import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Screen from '../components/Screen';
import Pressy from '../components/Pressy';
import Icon from '../icons/Icon';
import { colors, type, radius } from '../theme/theme';
import { useAppStore } from '../store/AppStore';
import { useChat } from '../store/ChatStore';
import { supabase } from '../lib/supabase';
import { RootStackParamList } from '../navigation/types';
import { ChatMessage } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { listingTitle } from '../lib/listingText';

type Props = NativeStackScreenProps<RootStackParamList, 'ChatThread'>;

// Phase 4 item 11 -- one conversation. Loads history, subscribes to new
// messages for the duration this screen is mounted (see ChatStore's
// subscribeToThread), and sends via the same store. The "other participant"
// name/listing context in the top bar is resolved the same way ChatScreen's
// list rows are: from AppStore's `listings` array when I'm the buyer (the
// listing already carries the seller's name), or one small profiles lookup
// when I'm the seller (the buyer's name isn't on the listing).
// Phase 4 item 15 -- quick-reply chip labels. Kept as translation keys
// (not free text) so they read naturally in Arabic too, same as
// everything else user-facing in this app.
const QUICK_REPLY_KEYS = [
  'chat.quickReply.available',
  'chat.quickReply.location',
  'chat.quickReply.lastPrice',
  'chat.quickReply.interested',
] as const;

export default function ChatThreadScreen({ route, navigation }: Props) {
  const { threadId } = route.params;
  const { t, language } = useLanguage();
  const { profile, listings } = useAppStore();
  const { threads, messagesByThread, loadMessages, sendMessage, sendOffer, respondToOffer, subscribeToThread, loadThreads } = useChat();
  const [otherName, setOtherName] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [quickReplyBusy, setQuickReplyBusy] = useState(false);
  const [offerPanelOpen, setOfferPanelOpen] = useState(false);
  const [offerAmount, setOfferAmount] = useState('');
  const [offerSending, setOfferSending] = useState(false);
  const [offerError, setOfferError] = useState<string | null>(null);
  const [offerRespondingId, setOfferRespondingId] = useState<string | null>(null);
  const listRef = useRef<FlatList>(null);

  const thread = threads.find((th) => th.id === threadId);
  const listing = thread ? listings.find((l) => l.id === thread.listingId) : undefined;
  const messages = messagesByThread[threadId] || [];

  // If this screen is opened directly (deep link / refresh) before the
  // thread list has ever loaded, `threads` is empty -- fetch it once so
  // `thread` above resolves instead of staying undefined forever.
  useEffect(() => {
    if (!thread) loadThreads().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  useEffect(() => {
    setLoading(true);
    loadMessages(threadId).finally(() => setLoading(false));
    const unsubscribe = subscribeToThread(threadId);
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  // Extra safety net alongside ChatStore's own resync-on-resubscribe: some
  // mobile browsers throttle/pause JS timers (including the realtime
  // websocket's heartbeat) while a tab is backgrounded without ever firing
  // a detectable disconnect, so the reconnect-triggered reload in
  // subscribeToThread may not kick in right away. Re-fetching whenever the
  // tab becomes visible again closes that gap without requiring the user
  // to actually leave and re-enter the thread. Web-only, same pattern as
  // App.tsx's AdminActivityListener.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const handler = () => {
      if (document.visibilityState === 'visible') loadMessages(threadId).catch(() => {});
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  useEffect(() => {
    if (messages.length > 0) {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    }
  }, [messages.length]);

  useEffect(() => {
    if (!thread) return;
    const iAmSeller = thread.sellerId === profile.id;
    if (!iAmSeller) {
      setOtherName(listing?.sellerName || t('chat.seller'));
      return;
    }
    // I'm the seller -- look up the buyer's name (not on the listing
    // object). Explicit column list -- see ChatScreen.tsx's same comment.
    supabase
      .from('profiles')
      .select('id, full_name')
      .eq('id', thread.buyerId)
      .maybeSingle()
      .then(({ data }) => setOtherName(data?.full_name || t('chat.buyer')));
  }, [thread, listing, profile.id, t]);

  const handleSend = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setDraft('');
    try {
      await sendMessage(threadId, body);
    } catch (e) {
      setDraft(body); // give the text back so it isn't just lost
    } finally {
      setSending(false);
    }
  };

  const handleQuickReply = async (text: string) => {
    if (quickReplyBusy || sending) return;
    setQuickReplyBusy(true);
    try {
      await sendMessage(threadId, text);
    } catch {
      // Best-effort -- same as a regular send failing, nothing else to do
      // for a one-tap chip.
    } finally {
      setQuickReplyBusy(false);
    }
  };

  const openOfferPanel = () => {
    setOfferAmount('');
    setOfferError(null);
    setOfferPanelOpen(true);
  };

  const handleSendOffer = async () => {
    const amount = Number(offerAmount);
    if (!amount || amount <= 0) {
      setOfferError(t('chat.offerAmountPlaceholder'));
      return;
    }
    setOfferSending(true);
    setOfferError(null);
    try {
      await sendOffer(threadId, amount);
      setOfferPanelOpen(false);
    } catch {
      setOfferError(t('chat.offerFailed'));
    } finally {
      setOfferSending(false);
    }
  };

  const handleRespondToOffer = async (messageId: string, status: 'accepted' | 'declined') => {
    if (offerRespondingId) return;
    setOfferRespondingId(messageId);
    try {
      await respondToOffer(messageId, status);
    } catch {
      // Best-effort -- the buttons just stay put, the buyer/seller can try
      // again.
    } finally {
      setOfferRespondingId(null);
    }
  };

  const listingTitleText = listing ? listingTitle(listing, language) : t('chat.listingRemoved');

  return (
    <Screen edges={['top', 'left', 'right']} maxWidth={720}>
      <View style={styles.topBar}>
        <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <Icon name="back" size={18} />
        </Pressy>
        <View style={{ flex: 1 }}>
          <Text style={type.h3} numberOfLines={1}>{otherName || t('chat.buyer')}</Text>
          <Text style={type.tiny} numberOfLines={1}>{listingTitleText}</Text>
        </View>
        {!!listing && (
          <Pressy onPress={() => navigation.navigate('ListingDetail', { listingId: listing.id })} style={styles.iconBtn}>
            <Icon name="bag" size={16} color={colors.inkSoft} />
          </Pressy>
        )}
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        {!loading && messages.length === 0 ? (
          <View style={styles.empty}>
            <Text style={[type.soft, { textAlign: 'center' }]}>{t('chat.threadEmpty')}</Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m: ChatMessage) => m.id}
            contentContainerStyle={styles.messages}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            renderItem={({ item }) => {
              const mine = item.senderId === profile.id;
              if (item.kind === 'offer') {
                return (
                  <View style={[styles.bubbleRow, mine ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
                    <View style={styles.offerCard}>
                      <Text style={styles.offerAmountText}>
                        {t('chat.offerBubbleTitle', { amount: (item.offerAmount ?? 0).toLocaleString() })}
                      </Text>
                      <View
                        style={[
                          styles.offerStatusPill,
                          item.offerStatus === 'accepted' && styles.offerStatusPillAccepted,
                          item.offerStatus === 'declined' && styles.offerStatusPillDeclined,
                        ]}
                      >
                        <Text style={styles.offerStatusPillText}>
                          {t(`chat.offerStatus.${item.offerStatus || 'pending'}` as any)}
                        </Text>
                      </View>
                      {!mine && item.offerStatus === 'pending' && (
                        <View style={styles.offerActionsRow}>
                          <Pressy
                            onPress={() => handleRespondToOffer(item.id, 'declined')}
                            disabled={offerRespondingId === item.id}
                            style={styles.offerDeclineBtn}
                          >
                            <Text style={styles.offerDeclineBtnText}>{t('chat.offerDecline')}</Text>
                          </Pressy>
                          <Pressy
                            onPress={() => handleRespondToOffer(item.id, 'accepted')}
                            disabled={offerRespondingId === item.id}
                            style={styles.offerAcceptBtn}
                          >
                            <Text style={styles.offerAcceptBtnText}>{t('chat.offerAccept')}</Text>
                          </Pressy>
                        </View>
                      )}
                    </View>
                  </View>
                );
              }
              return (
                <View style={[styles.bubbleRow, mine ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
                  <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                    <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{item.body}</Text>
                  </View>
                </View>
              );
            }}
          />
        )}

        {/* Phase 4 item 15 follow-up (2026-08-15, user-reported): the chip
            row + composer are grouped into one `bottomBar` unit, styled as a
            single toolbar (shared background, one top border) and pinned to
            the viewport bottom via `position: sticky` on web. Previously the
            chip row was a plain, background-less sibling that only *looked*
            centered on an empty thread because the empty-state placeholder
            above it soaks up the remaining flex space with nothing visually
            anchoring the row to the composer below it -- sticky+shared
            styling keeps both glued to the bottom regardless of how much
            (or how little) space the message area above ends up taking. */}
        <View style={styles.bottomBar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.quickReplyRow}
            contentContainerStyle={styles.quickReplyRowContent}
          >
            <Pressy onPress={openOfferPanel} style={styles.offerChip}>
              <Icon name="banknote" size={13} color={colors.white} />
              <Text style={styles.offerChipText}>{t('chat.makeOffer')}</Text>
            </Pressy>
            {QUICK_REPLY_KEYS.map((key) => (
              <Pressy key={key} onPress={() => handleQuickReply(t(key))} disabled={quickReplyBusy} style={styles.quickReplyChip}>
                <Text style={styles.quickReplyChipText}>{t(key)}</Text>
              </Pressy>
            ))}
          </ScrollView>

          <View style={styles.composer}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={t('chat.messagePlaceholder')}
              style={styles.input}
              multiline
              onSubmitEditing={handleSend}
              // react-native-web only calls onSubmitEditing for a multiline
              // TextInput when blurOnSubmit is explicitly true (it defaults
              // to false for multiline fields) -- so onSubmitEditing above
              // never actually fired on Enter, and the browser's own default
              // behavior (insert a newline) ran instead. Intercepting the
              // raw keydown here (web only) lets plain Enter send while
              // Shift+Enter still inserts a newline, without blurring the
              // field afterward so the keyboard/focus stays put for the next
              // message -- matches standard chat-app Enter behavior.
              onKeyPress={(e: any) => {
                if (Platform.OS !== 'web') return;
                const composing = e.nativeEvent?.isComposing || e.nativeEvent?.keyCode === 229;
                if (e.key === 'Enter' && !e.shiftKey && !composing) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
            <Pressy onPress={handleSend} disabled={!draft.trim() || sending} style={[styles.sendBtn, (!draft.trim() || sending) && styles.sendBtnDisabled]}>
              <Text style={styles.sendBtnText}>{t('chat.send')}</Text>
            </Pressy>
          </View>
        </View>
      </KeyboardAvoidingView>

      <Modal transparent visible={offerPanelOpen} animationType="fade" onRequestClose={() => setOfferPanelOpen(false)}>
        <View style={styles.offerBackdrop}>
          <Pressy onPress={() => setOfferPanelOpen(false)} style={StyleSheet.absoluteFill} />
          <View style={styles.offerPanelCard}>
            <Text style={type.h3}>{t('chat.makeOffer')}</Text>
            <TextInput
              value={offerAmount}
              onChangeText={setOfferAmount}
              placeholder={t('chat.offerAmountPlaceholder')}
              keyboardType="numeric"
              style={styles.offerAmountInput}
            />
            {!!offerError && <Text style={styles.reportErrorText}>{offerError}</Text>}
            <View style={styles.offerPanelActions}>
              <Pressy onPress={() => setOfferPanelOpen(false)} style={styles.offerPanelCancelBtn}>
                <Text style={styles.offerPanelCancelBtnText}>{t('chat.offerCancel')}</Text>
              </Pressy>
              <Pressy
                onPress={handleSendOffer}
                disabled={offerSending || !offerAmount.trim()}
                style={[styles.offerPanelSendBtn, (offerSending || !offerAmount.trim()) && styles.sendBtnDisabled]}
              >
                <Text style={styles.offerPanelSendBtnText}>
                  {offerSending ? t('common.loading') : t('chat.offerSend')}
                </Text>
              </Pressy>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 56,
    borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  messages: { padding: 16, gap: 8 },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubbleRowTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '78%', borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 9 },
  bubbleMine: { backgroundColor: colors.ink, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 14.5, lineHeight: 20, color: colors.ink },
  bubbleTextMine: { color: colors.white },
  // Phase 4 item 15 follow-up (2026-08-15) -- the chip row + composer used
  // to be two independent siblings at the end of the flex column, which on
  // an empty thread left the chip row visually stranded wherever the
  // empty-state placeholder's flex:1 centering happened to land it, with a
  // big dead gap down to the composer. Grouping both into one `bottomBar`
  // shell (shared background/border, `position: sticky` on web) makes them
  // read as a single toolbar that's always glued to the bottom of the
  // screen, the same way a messaging app's suggestion chips sit directly
  // above the keyboard/input rather than floating mid-conversation.
  bottomBar: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    ...(Platform.OS === 'web' ? ({ position: 'sticky', bottom: 0 } as any) : null),
  },
  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  input: {
    flex: 1, minHeight: 40, maxHeight: 100, borderRadius: radius.md,
    backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line,
    paddingHorizontal: 14, paddingVertical: 9, fontSize: 14.5, color: colors.ink,
  },
  sendBtn: {
    height: 40, paddingHorizontal: 16, borderRadius: radius.pill,
    backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { fontSize: 14, fontWeight: '600', color: colors.white },

  // Quick-reply chips + "Make an offer" -- now the top strip of `bottomBar`
  // above, with its own thin bottom divider separating it from the
  // composer so the two read as stacked sections of one toolbar rather
  // than one chip row loose in open space.
  quickReplyRow: {
    borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  quickReplyRowContent: {
    flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingVertical: 10,
  },
  offerChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    height: 32, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.ink,
  },
  offerChipText: { fontSize: 12.5, fontWeight: '700', color: colors.white },
  quickReplyChip: {
    height: 32, paddingHorizontal: 14, borderRadius: radius.pill,
    backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center',
  },
  quickReplyChipText: { fontSize: 12.5, fontWeight: '600', color: colors.ink },

  // Structured offer bubble -- a card instead of a plain text bubble,
  // shown on both sides of the conversation (the sender sees their own
  // offer's status update live too).
  offerCard: {
    maxWidth: '78%', borderRadius: radius.md, padding: 14, gap: 8,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
  },
  offerAmountText: { fontSize: 16, fontWeight: '700', color: colors.ink },
  offerStatusPill: {
    alignSelf: 'flex-start', backgroundColor: colors.warnBg, borderRadius: radius.pill,
    paddingHorizontal: 10, height: 22, justifyContent: 'center',
  },
  offerStatusPillAccepted: { backgroundColor: '#e3efe8' },
  offerStatusPillDeclined: { backgroundColor: '#f3e0de' },
  offerStatusPillText: { fontSize: 11, fontWeight: '700', color: colors.ink },
  offerActionsRow: { flexDirection: 'row', gap: 8, marginTop: 2 },
  offerDeclineBtn: {
    flex: 1, height: 36, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center',
  },
  offerDeclineBtnText: { fontSize: 12.5, fontWeight: '600', color: colors.inkSoft },
  offerAcceptBtn: {
    flex: 1, height: 36, borderRadius: radius.pill, backgroundColor: colors.ink,
    alignItems: 'center', justifyContent: 'center',
  },
  offerAcceptBtnText: { fontSize: 12.5, fontWeight: '700', color: colors.white },

  // "Make an offer" panel -- same backdrop/card pattern as
  // ListingDetailScreen's report modal.
  offerBackdrop: {
    flex: 1, backgroundColor: 'rgba(20,20,22,0.45)',
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  offerPanelCard: {
    width: '100%', maxWidth: 360, backgroundColor: colors.bg,
    borderRadius: radius.lg, padding: 22, gap: 10,
  },
  offerAmountInput: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.sm, paddingHorizontal: 14, height: 46, fontSize: 14.5, color: colors.ink,
  },
  reportErrorText: { fontSize: 12.5, color: colors.danger },
  offerPanelActions: { flexDirection: 'row', gap: 10, marginTop: 6 },
  offerPanelCancelBtn: { height: 48, paddingHorizontal: 16, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  offerPanelCancelBtnText: { fontSize: 14.5, fontWeight: '600', color: colors.inkSoft },
  offerPanelSendBtn: {
    flex: 1, height: 48, borderRadius: radius.pill, backgroundColor: colors.ink,
    alignItems: 'center', justifyContent: 'center',
  },
  offerPanelSendBtnText: { fontSize: 14.5, fontWeight: '600', color: colors.white },
});
