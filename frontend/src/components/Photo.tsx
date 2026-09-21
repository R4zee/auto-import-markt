import { useEffect, useState } from 'react';

/**
 * Fahrzeugfoto mit Platzhalter – ersetzt den Editor-Baustein <image-slot> aus dem Design.
 * Schlägt das Laden fehl und die URL trägt Parameter (z. B. Größenangaben eines CDN), wird sie einmal ohne
 * Query-String versucht – Sauto-Bilder aus dem Bestand tragen noch einen Parameter, den das CDN ablehnt.
 */
export function Photo({ src, alt, hint }: { src?: string; alt: string; hint: string }) {
  const [current, setCurrent] = useState<string | undefined>(src);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setCurrent(src); setFailed(false); }, [src]);
  if (current && !failed) {
    const onError = () => {
      const bare = current.split('?')[0];
      if (current.includes('?') && bare !== current) setCurrent(bare);
      else setFailed(true);
    };
    // referrerPolicy: einige Bild-CDNs (z. B. sdn.cz von Sauto) weisen Anfragen mit fremdem Referer ab
    return <img className="aim-photo lighten" src={current} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={onError} />;
  }
  return (
    <div className="aim-photo-empty" aria-label={alt}>
      <div>
        <i className="ph ph-car-profile" />
        {hint}
      </div>
    </div>
  );
}
