import { useTranslation } from 'react-i18next';

/** An honest placeholder for sections not built yet. */
export function PlaceholderPage({ navKey, phase }: { navKey: string; phase: string }) {
  const { t } = useTranslation();
  return (
    <div className="page">
      <h1>{t('placeholder.title', { section: t(`nav.${navKey}`) })}</h1>
      <div className="card empty">{t('placeholder.body', { phase })}</div>
    </div>
  );
}
