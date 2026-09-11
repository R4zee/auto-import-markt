import { useState } from 'react';

/** Fahrzeugfoto mit Platzhalter – ersetzt den Editor-Baustein <image-slot> aus dem Design. */
export function Photo({ src, alt, hint }: { src?: string; alt: string; hint: string }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return <img className="aim-photo lighten" src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />;
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
