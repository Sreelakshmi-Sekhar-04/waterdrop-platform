import { useTranslation } from 'react-i18next';

export function TodayPage() {
  const { t } = useTranslation();
  return (
    <div className="page">
      <h1>{t('today.title')}</h1>
      <section aria-labelledby="attention-h">
        <h2 id="attention-h">{t('today.attention')}</h2>
        <div className="card empty">{t('today.attentionEmpty')}</div>
      </section>
      <section aria-labelledby="sofar-h">
        <h2 id="sofar-h">{t('today.soFar')}</h2>
        <div className="card empty">{t('today.soFarEmpty')}</div>
      </section>
    </div>
  );
}
