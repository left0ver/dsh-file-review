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
