import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { OPENING_CSV_HEADER, parseOpeningCsv, type OpeningParse } from '@wtrdrop/shared';
import { call } from '../lib/api';
import { errorText } from '../lib/errors';
import { Dialog } from './Dialog';
import { Chip, TableWrap, maskPhone } from './ui';

interface Result {
  dryRun: boolean;
  summary: { new: number; existing: number; errors: number };
  results: {
    line: number;
    phoneLast4: string;
    name: string | null;
    status: 'new' | 'existing' | 'error';
    code?: string;
  }[];
}

const TEMPLATE = `${OPENING_CSV_HEADER}\n9847000001,Anil Kumar,2,300,2,450\n`;

/**
 * M-04: bring in the cans, deposits and dues customers already had before WtrDrop. The owner
 * checks a preview from the server first; nothing is saved until "Import" is pressed, and a
 * customer who already has entries is never given a second opening balance.
 */
export function OpeningImportDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<OpeningParse | null>(null);
  const [preview, setPreview] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => {
    setText('');
    setParsed(null);
    setPreview(null);
    setError(null);
    onClose();
  };
  const send = async (p: OpeningParse, dryRun: boolean) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await call<Result>('/admin/opening-balances', {
        method: 'POST',
        body: { rows: p.rows.map((x) => ({ ...x.row, line: x.line })), dryRun },
      });
      if (dryRun) setPreview(r);
      else {
        void qc.invalidateQueries({ queryKey: ['customers'] });
        void qc.invalidateQueries({ queryKey: ['dues'] });
        void qc.invalidateQueries({ queryKey: ['stock'] });
        onDone(t('opening.done', { count: r.summary.new + r.summary.existing }));
        close();
      }
    } catch (e) {
      setError(errorText(t, e));
    } finally {
      setBusy(false);
    }
  };
  // Check the lines here first, then ask the server what each one would do (nothing is saved).
  const check = () => {
    const p = parseOpeningCsv(text);
    setParsed(p);
    setPreview(null);
    if (p.errors.length === 0 && p.rows.length > 0) void send(p, true);
  };
  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setText(await file.text());
    setParsed(null);
    setPreview(null);
  };
  const ok = preview && preview.summary.new + preview.summary.existing > 0;

  return (
    <Dialog open={open} title={t('opening.title')} onClose={close}>
      <div className="form">
        <p className="muted">{t('opening.help')}</p>
        <p className="field-hint">
          <code>{OPENING_CSV_HEADER}</code>{' '}
          <a
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`}
            download="wtrdrop-opening-balances.csv"
          >
            {t('opening.template')}
          </a>
        </p>
        <label className="field">
          <span>{t('opening.file')}</span>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => void readFile(e.target.files?.[0])}
          />
        </label>
        <label className="field">
          <span>{t('opening.paste')}</span>
          <textarea
            rows={6}
            value={text}
            spellCheck={false}
            onChange={(e) => {
              setText(e.target.value);
              setParsed(null);
              setPreview(null);
            }}
          />
        </label>

        {parsed && parsed.errors.length > 0 ? (
          <div role="alert">
            <p className="field-error">{t('opening.fixLines', { count: parsed.errors.length })}</p>
            <ul className="error-list">
              {parsed.errors.slice(0, 20).map((e, i) => (
                <li key={i}>
                  {e.line > 0 ? t('opening.line', { n: e.line }) : ''} {e.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {parsed && parsed.errors.length === 0 && parsed.rows.length === 0 ? (
          <p className="field-error" role="alert">
            {t('opening.empty')}
          </p>
        ) : null}

        {preview ? (
          <>
            <p role="status" data-testid="opening-summary">
              {t('opening.summary', {
                fresh: preview.summary.new,
                existing: preview.summary.existing,
                errors: preview.summary.errors,
              })}
            </p>
            <TableWrap label={t('opening.title')}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">{t('opening.cols.line')}</th>
                    <th scope="col">{t('money.cols.customer')}</th>
                    <th scope="col">{t('money.cols.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.results.map((r) => (
                    <tr key={r.line}>
                      <td className="num">{r.line}</td>
                      <th scope="row">
                        {r.name ?? t('customers.noName')}
                        <span className="cell-note">{maskPhone(r.phoneLast4)}</span>
                      </th>
                      <td className="wrap">
                        {r.status === 'error' ? (
                          <Chip tone="warning">{t(`opening.codes.${r.code ?? 'UNKNOWN'}`)}</Chip>
                        ) : (
                          <Chip tone={r.status === 'new' ? 'info' : 'success'}>
                            {t(`opening.status.${r.status}`)}
                          </Chip>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </>
        ) : null}

        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="form-actions">
          {ok ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => parsed && void send(parsed, false)}
            >
              {t('opening.import', {
                count: preview.summary.new + preview.summary.existing,
              })}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !text.trim()}
              onClick={check}
            >
              {t('opening.check')}
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={close}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
