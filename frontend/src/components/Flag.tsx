import { flag } from '../format';

export function Flag({ code, small }: { code: string; small?: boolean }) {
  return <span className={`aim-flag${small ? ' aim-flag-sm' : ''}`} style={{ backgroundImage: `url(${flag(code)})` }} aria-hidden="true" />;
}
