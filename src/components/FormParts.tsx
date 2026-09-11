import React from 'react';
import { StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';
import Pressy from './Pressy';
import Icon from '../icons/Icon';
import { colors, radius, type } from '../theme/theme';
import { useLanguage } from '../i18n/LanguageContext';
import { mirrorRow } from '../lib/mirrorRow';

// The pieces the two tester forms are built from (TesterOnboardingScreen,
// TesterReportScreen): one card per question, the way a paper form lays
// them out; answer rows with a round or a square mark; a text box. The
// reading direction comes from the language here, once, because on the
// phone app a row does not mirror by itself (see mirrorRow).

export function QuestionCard({
  title,
  required,
  help,
  error,
  children,
  cardRef,
}: {
  title: string;
  required?: boolean;
  help?: string;
  error?: string | null;
  children: React.ReactNode;
  // So the form can find the first question that needs an answer and
  // scroll to it -- measured when Send is pressed, not remembered from
  // layout: on the website a card that MOVES (because a question above it
  // appeared) reports no new layout, only one that changes size does.
  cardRef?: (view: View | null) => void;
}) {
  const { isRTL } = useLanguage();
  const textDir = isRTL ? styles.rtl : null;
  return (
    <View ref={cardRef} style={[styles.card, !!error && styles.cardError]}>
      <Text style={[styles.title, textDir]}>
        {title}
        {required ? <Text style={styles.star}> *</Text> : null}
      </Text>
      {!!help && <Text style={[styles.help, textDir]}>{help}</Text>}
      <View style={styles.body}>{children}</View>
      {!!error && <Text style={[styles.error, textDir]}>{error}</Text>}
    </View>
  );
}

export type Choice<T extends string> = { value: T; label: string };

// One answer (round marks) or several (square marks, `multi`). Each row is
// a full-width target: a thumb should never have to find a 20-point circle.
export function ChoiceList<T extends string>({
  options,
  selected,
  onPick,
  multi,
  disabled,
}: {
  options: Choice<T>[];
  selected: T | readonly T[] | null;
  // The value tapped. A multi list toggles it; the caller keeps the list.
  onPick: (value: T) => void;
  multi?: boolean;
  disabled?: boolean;
}) {
  const { isRTL } = useLanguage();
  const rowDir = mirrorRow(isRTL);
  const textDir = isRTL ? styles.rtl : null;
  const isOn = (v: T) => (Array.isArray(selected) ? selected.includes(v) : selected === v);
  return (
    <View style={styles.choices}>
      {options.map((o) => {
        const on = isOn(o.value);
        return (
          <Pressy
            key={o.value}
            onPress={() => onPick(o.value)}
            disabled={disabled}
            haptic={false}
            style={[styles.choice, rowDir, on && styles.choiceOn]}
            accessibilityRole={multi ? 'checkbox' : 'radio'}
            accessibilityState={{ checked: on, disabled: !!disabled }}
            accessibilityLabel={o.label}
          >
            <View style={[multi ? styles.box : styles.radio, on && (multi ? styles.boxOn : styles.radioOn)]}>
              {on && (multi ? <Icon name="check" size={13} color={colors.white} /> : <View style={styles.dot} />)}
            </View>
            <Text style={[styles.choiceText, textDir]}>{o.label}</Text>
          </Pressy>
        );
      })}
    </View>
  );
}

// A heading between groups of answers -- the roles in the mission list.
export function ChoiceGroupLabel({ label }: { label: string }) {
  const { isRTL } = useLanguage();
  return <Text style={[styles.groupLabel, isRTL ? styles.rtl : null]}>{label}</Text>;
}

export function FormInput({ invalid, style, multiline, ...rest }: TextInputProps & { invalid?: boolean }) {
  const { isRTL } = useLanguage();
  return (
    <TextInput
      placeholderTextColor={colors.inkSoft}
      multiline={multiline}
      {...rest}
      style={[
        styles.input,
        multiline && styles.inputMultiline,
        invalid && styles.inputInvalid,
        { textAlign: isRTL ? 'right' : 'left' },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: 16,
    marginBottom: 12,
  },
  cardError: { borderColor: colors.danger },
  title: { ...type.h3, fontSize: 15.5, lineHeight: 22 },
  star: { color: colors.danger },
  help: { ...type.soft, marginTop: 4 },
  body: { marginTop: 12 },
  error: { fontSize: 13, color: colors.danger, marginTop: 10, fontWeight: '600' },
  rtl: { textAlign: 'right' },
  choices: { gap: 8 },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg,
  },
  choiceOn: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
  choiceText: { ...type.body, flex: 1 },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.inkSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: colors.primary },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  box: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: colors.inkSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { borderColor: colors.primary, backgroundColor: colors.primary },
  groupLabel: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 6, marginBottom: 2 },
  input: {
    minHeight: 48,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.ink,
  },
  inputMultiline: { minHeight: 120, textAlignVertical: 'top' },
  inputInvalid: { borderColor: colors.danger },
});
