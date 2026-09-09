import { useState } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { DEFAULT_WORD_WRAP, type Config } from '../settings-contract.ts'
import css from './FileReviewSettingsCard.module.css'
import { NS } from './locales.ts'

export type FileReviewSettingsCardInjected = {
  hooks: { fileReviewSettings: SettingsScope<Config> }
  setWordWrap(value: boolean): Promise<void>
}

export type FileReviewSettingsCardProps = PropsRuntime<'settings.plugin.item'> &
  PropsLocale<typeof NS> &
  InjectFace<FileReviewSettingsCardInjected>

/** Minimal settings card owned by the file-review plugin. */
export function FileReviewSettingsCard({
  setWordWrap,
  t,
  useFileReviewSettings,
}: FileReviewSettingsCardProps) {
  const settings = useFileReviewSettings((snapshot) => snapshot)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  if (settings.status !== 'ready') return null

  const title = t('settings.title')
  const wordWrap = settings.value?.wordWrap ?? DEFAULT_WORD_WRAP
  const writable = settings.writable && !saving

  const toggleWordWrap = async (): Promise<void> => {
    setSaving(true)
    try {
      await setWordWrap(!wordWrap)
    } catch {
      // SettingsScope refreshes the authoritative value after a rejected write.
    } finally {
      setSaving(false)
    }
  }

  return (
    <li className={`${css.card} ${open ? css.cardOpen : ''}`}>
      <button
        type="button"
        className={css.header}
        aria-expanded={open}
        aria-label={`${t(open ? 'settings.collapse' : 'settings.expand')}: ${title}`}
        onClick={() => {
          setOpen((value) => !value)
        }}
      >
        <svg className={css.icon} viewBox="0 0 32 32" aria-hidden="true">
          <path d="M16 3H6a2 2 0 0 0-2 2v22a2 2 0 0 0 2 2h10M16 3l7 7v5M16 3v7h7" />
          <path d="M8 14h6" stroke="var(--dsw-alias-state-error-primary, #d65f76)" />
          <path d="M8 21h6m-3-3v6" stroke="var(--dsw-alias-state-success-primary, #269d80)" />
          <circle cx="23" cy="23" r="6" fill="var(--dsw-alias-bg-layer-3)" />
          <path d="m27.5 27.5 3 3" strokeWidth="2.5" />
          <path d="m20.5 23 1.5 1.5 3-3" />
        </svg>
        <span className={css.heading}>
          <span className={css.title}>{title}</span>
          <span className={css.description}>{t('settings.description')}</span>
        </span>
        <svg
          className={`${css.chevron} ${open ? css.chevronOpen : ''}`}
          width="14"
          height="14"
          viewBox="0 0 14 14"
          aria-hidden="true"
        >
          <path
            d="m3.5 5.25 3.5 3.5 3.5-3.5"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <a
        className={css.github}
        href="https://github.com/left0ver/dsh-file-review"
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t('settings.star.aria')}
      >
        <svg className={css.githubIcon} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2.4a9.8 9.8 0 0 0-3.1 19.1c.5.1.7-.2.7-.5v-1.9c-2.8.6-3.4-1.2-3.4-1.2-.5-1.1-1.1-1.4-1.1-1.4-.9-.6.1-.6.1-.6 1 0 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.6.4-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-4.9 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.8 1a9.5 9.5 0 0 1 5 0c1.9-1.3 2.8-1 2.8-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.8-2.3 4.6-4.6 4.9.4.3.7.9.7 1.8V21c0 .3.2.6.7.5A9.8 9.8 0 0 0 12 2.4Z" />
        </svg>
        <span className={css.heading}>
          <span className={css.githubTitle}>
            <span className={css.star} aria-hidden="true">
              ★
            </span>
            {t('settings.star.title')}
          </span>
          <span className={css.githubSlug}>left0ver/dsh-file-review</span>
        </span>
        <svg className={css.externalIcon} viewBox="0 0 16 16" aria-hidden="true">
          <path d="M6 3h7v7M13 3 7 9M11 9v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h3" />
        </svg>
      </a>
      {open ? (
        <div className={css.body}>
          <div className={css.row}>
            <span className={css.field}>
              <span className={css.label}>{t('settings.wordWrap.title')}</span>
              <span className={css.hint}>{t('settings.wordWrap.description')}</span>
            </span>
            <button
              type="button"
              role="switch"
              className={css.toggle}
              aria-checked={wordWrap}
              aria-label={t('settings.wordWrap.title')}
              aria-busy={saving}
              data-checked={wordWrap}
              disabled={!writable}
              onClick={() => {
                void toggleWordWrap()
              }}
            >
              <span className={css.thumb} />
            </button>
          </div>
          {!settings.writable ? <p className={css.readOnly}>{t('settings.readOnly')}</p> : null}
        </div>
      ) : null}
    </li>
  )
}
