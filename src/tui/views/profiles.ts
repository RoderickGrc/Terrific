import type { ProfileView } from '../../core/api.ts';
import { blank, type Line, line } from '../layout.ts';
import { PROFILE_FIELDS, type ProfileDraft, type ProfilesOverlay } from '../state.ts';
import { inputText, sep, type View } from './common.ts';

const NAME_WIDTH = 16;
const MODE_WIDTH = 12;

const MODE_TEXT = {
  persistent: 'keeps logins and data',
  snapshot: 'restores what you save',
} as const;

function modeLabel(profile: ProfileView): string {
  return profile.kind === 'clean' ? '' : profile.kind;
}

export function profilesLines(view: View, overlay: ProfilesOverlay): Line[] {
  const { theme, state } = view;
  const p = theme.paint;
  const profiles = state.profiles;
  overlay.index = Math.min(overlay.index, Math.max(0, profiles.length - 1));
  const current = state.settings.lastSetup.profile;
  const kept = profiles.filter((profile) => profile.kind !== 'clean').length;
  const out: Line[] = [
    blank(),
    line(`   ${p('Browser profiles', { tone: 'fg1', bold: true })}`),
    blank(),
  ];
  const creating = overlay.creating !== null;
  profiles.forEach((profile, index) => {
    const on = index === overlay.index && !creating;
    const deleting = overlay.confirmDelete === profile.slug;
    const name =
      overlay.renaming === profile.slug
        ? inputText(theme, state.input, NAME_WIDTH + 8)
        : p(profile.slug.padEnd(NAME_WIDTH), {
            tone: deleting ? 'bug' : 'fg1',
            bold: on || deleting,
          });
    const marks: string[] = [];
    if (profile.open) marks.push(p('● open', 'accent'));
    if (profile.slug === current) marks.push(p('default', 'ok'));
    out.push(
      line(
        `   ${on ? p('▌', { tone: 'accent', bold: true }) : ' '} ${name} ${p(modeLabel(profile).padEnd(MODE_WIDTH), 'fg2')}${p(profile.detail, 'fg3')}`,
        `${marks.join('  ')}   `,
        on ? 'prompt' : undefined,
      ),
    );
  });
  if (kept === 0 && !creating) {
    out.push(
      blank(),
      line(
        `   ${p('Ctrl+N creates a profile terrific keeps, to log in once and reuse it in every session.', 'fg3')}`,
      ),
    );
  }
  const draft = overlay.creating;
  if (draft !== null) out.push(...draftLines(view, draft));
  return out;
}

function draftLines(view: View, draft: ProfileDraft): Line[] {
  const { theme, state } = view;
  const p = theme.paint;
  const field = PROFILE_FIELDS[draft.field] ?? 'name';
  const row = (
    key: (typeof PROFILE_FIELDS)[number],
    label: string,
    value: string,
    aside: string,
  ): Line => {
    const on = field === key;
    return line(
      `   ${on ? p('▌', { tone: 'accent', bold: true }) : ' '} ${p(label.padEnd(10), on ? 'fg1' : 'fg2')}${value}`,
      `${aside}   `,
      on ? 'prompt' : undefined,
    );
  };
  const choice = (
    options: readonly string[],
    selected: string,
    labels?: Record<string, string>,
  ): string =>
    options
      .map((option) =>
        option === selected
          ? p(labels?.[option] ?? option, { tone: 'accent', bold: true })
          : p(labels?.[option] ?? option, 'fg3'),
      )
      .join(sep(theme));
  const text = (key: 'name' | 'url', value: string, empty: string): string =>
    field === key
      ? inputText(theme, state.input, 40)
      : value === ''
        ? p(empty, 'fg3')
        : p(value, 'fg1');
  const browsers = state.browsers;
  const names = Object.fromEntries(browsers.map((browser) => [browser.id, browser.name]));
  return [
    blank(),
    line(`   ${p('New profile', { tone: 'fg1', bold: true })}`),
    row('name', 'Name', text('name', draft.name, 'required'), p('a-z, 0-9, dashes', 'fg3')),
    row(
      'mode',
      'Mode',
      choice(['persistent', 'snapshot'], draft.mode),
      p(MODE_TEXT[draft.mode], 'fg3'),
    ),
    row(
      'browser',
      'Browser',
      browsers.length === 0
        ? p('no browser installed', 'failure')
        : choice(
            browsers.map((browser) => browser.id),
            draft.browser ?? '',
            names,
          ),
      '',
    ),
    row('url', 'URL', text('url', draft.url, 'blank tab'), p('optional', 'fg3')),
  ];
}
