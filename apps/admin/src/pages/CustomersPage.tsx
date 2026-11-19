import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { formatINR } from '@wtrdrop/shared';
import { demoCustomers } from '../demo/fixtures';
import { DemoBadge, PageHeader, SearchField, TableWrap, maskPhone } from '../components/ui';

export function CustomersPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const needle = q.trim().toLowerCase();
  const digits = needle.replace(/\D/g, '');
  const rows = demoCustomers.filter(
    (c) =>
      needle === '' ||
      c.name.toLowerCase().includes(needle) ||
      c.area.toLowerCase().includes(needle) ||
      (digits.length > 0 && c.phoneLast4.includes(digits.slice(-4))),
  );

  return (
    <div className="page">
      <PageHeader
        title={t('nav.customers')}
        subtitle={<DemoBadge />}
        actions={
          <SearchField
            label={t('customers.searchLabel')}
            placeholder={t('customers.searchPlaceholder')}
            value={q}
            onChange={(v) => setParams(v ? { q: v } : {}, { replace: true })}
          />
        }
      />
      <p className="muted" role="status" aria-live="polite">
        {t('customers.count', { count: rows.length })}
      </p>
      {rows.length === 0 ? (
        <div className="card empty">{t('customers.empty', { q })}</div>
      ) : (
        <TableWrap label={t('nav.customers')}>
          <table>
            <thead>
              <tr>
                <th scope="col">{t('customers.cols.name')}</th>
                <th scope="col">{t('customers.cols.area')}</th>
                <th scope="col" className="num">
                  {t('customers.cols.cans')}
                </th>
                <th scope="col" className="num">
                  {t('customers.cols.due')}
                </th>
                <th scope="col">{t('customers.cols.lastOrder')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <th scope="row">
                    <Link to={`/customers/${c.id}`}>{c.name}</Link>
                    <span className="cell-note">
                      {t(`customers.type.${c.type}`)} · {maskPhone(c.phoneLast4)}
                    </span>
                  </th>
                  <td>{c.area}</td>
                  <td className="num">
                    {c.cansHeld}
                    {c.cansHeld > c.depositCans ? (
                      <span className="cell-note tone-warning">
                        {t('customers.overDeposit', { count: c.cansHeld - c.depositCans })}
                      </span>
                    ) : null}
                  </td>
                  <td className={`num${c.duePaise > 0 ? ' tone-warning' : ''}`}>
                    {c.duePaise > 0 ? formatINR(c.duePaise) : t('customers.noDue')}
                  </td>
                  <td>{c.lastOrder}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </div>
  );
}
